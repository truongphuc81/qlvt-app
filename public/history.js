// public/history.js
document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let transactions = [];
    let currentPage = 1;
    let totalPages = 1;
    let allItems = [];
    const LIMIT = 50;
    let filterTimeout;

    const editModal = new bootstrap.Modal(document.getElementById('editTxModal'));

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            document.getElementById('userEmailDisplay').innerText = user.email;
            initializePage();
        } else {
            window.location.href = 'index.html';
        }
    });

    function initializePage() {
        // Init Daterangepicker
        $('#dateRangeFilter').daterangepicker({
            autoUpdateInput: false,
            locale: {
                cancelLabel: 'Xóa',
                applyLabel: 'Chọn',
                format: 'DD/MM/YYYY'
            }
        });

        $('#dateRangeFilter').on('apply.daterangepicker', function(ev, picker) {
            $(this).val(picker.startDate.format('DD/MM/YYYY') + ' - ' + picker.endDate.format('DD/MM/YYYY'));
            debouncedLoadHistory();
        });

        $('#dateRangeFilter').on('cancel.daterangepicker', function(ev, picker) {
            $(this).val('');
            debouncedLoadHistory();
        });
        
        document.getElementById('emailFilter').addEventListener('change', debouncedLoadHistory);
        document.getElementById('typeFilter').addEventListener('change', debouncedLoadHistory);
        document.getElementById('itemFilter').addEventListener('input', () => debouncedLoadHistory(300));
        document.getElementById('searchFilter').addEventListener('input', () => debouncedLoadHistory(300));

        document.getElementById('historyTableBody').addEventListener('click', handleTableClick);
        document.getElementById('saveTxChangesBtn').addEventListener('click', handleSaveChanges);
        document.getElementById('pagination').addEventListener('click', handlePaginationClick);

        loadFilterData();
        loadHistory();
    }
    
    function debouncedLoadHistory(delay = 0) {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => {
            currentPage = 1; 
            loadHistory();
        }, delay);
    }

    async function loadFilterData() {
        try {
            const technicians = await callApi('/public/technicians', {});
            const emailFilter = document.getElementById('emailFilter');
            technicians.forEach(tech => {
                const option = document.createElement('option');
                option.value = tech.email;
                option.textContent = `${tech.name} (${tech.email})`;
                emailFilter.appendChild(option);
            });
        } catch (e) {
            console.error("Lỗi tải danh mục KTV:", e);
        }
        
         try {
            allItems = await callApi('/inventory/list', {});
            $("#itemFilter").autocomplete({
                source: allItems.map(item => ({ label: `${item.name} (${item.code})`, value: item.code })),
                select: function(event, ui) {
                    event.preventDefault();
                    $(this).val(ui.item.value);
                    debouncedLoadHistory();
                }
            });
        } catch (e) {
            console.error("Lỗi tải danh mục vật tư:", e);
        }
    }

    async function loadHistory() {
        const spinner = document.getElementById('loadingSpinner');
        spinner.style.display = 'block';

        const dateRange = $('#dateRangeFilter').val();
        let startDate, endDate;
        if (dateRange) {
            const dates = dateRange.split(' - ');
            startDate = moment(dates[0], 'DD/MM/YYYY').startOf('day').toISOString();
            endDate = moment(dates[1], 'DD/MM/YYYY').endOf('day').toISOString();
        }

        const filters = {
            startDate,
            endDate,
            email: document.getElementById('emailFilter').value,
            type: document.getElementById('typeFilter').value,
            item: document.getElementById('itemFilter').value,
            search: document.getElementById('searchFilter').value,
        };

        try {
            const response = await callApi('/history/list', { filters, page: currentPage, limit: LIMIT });
            transactions = response.transactions;
            totalPages = Math.ceil(response.total / LIMIT);
            renderTable();
            renderPagination();
        } catch (error) {
            console.error('Error loading history:', error);
            alert('Không thể tải lịch sử giao dịch. ' + error.message);
        } finally {
            spinner.style.display = 'none';
        }
    }

    function renderTable() {
        const tableBody = document.getElementById('historyTableBody');
        tableBody.innerHTML = '';
        if (transactions.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="text-center">Không tìm thấy giao dịch nào.</td></tr>`;
            return;
        }

        transactions.forEach(tx => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${tx.timestamp}</td>
                <td>${tx.date}</td>
                <td>${tx.email}</td>
                <td><span class="badge ${tx.type === 'Mượn' ? 'bg-primary' : 'bg-success'}">${tx.type}</span></td>
                <td>${tx.code || ''}</td>
                <td>${tx.name || ''}</td>
                <td>${tx.quantity}</td>
                <td class="text-truncate" style="max-width: 150px;">${tx.note || ''}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary edit-btn" data-item-id="${tx.itemId}" title="Sửa"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger delete-btn" data-item-id="${tx.itemId}" title="Xóa"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function renderPagination() {
        const paginationEl = document.getElementById('pagination');
        paginationEl.innerHTML = '';
        if(totalPages <= 1) return;

        const ul = document.createElement('ul');
        ul.className = 'pagination';

        for (let i = 1; i <= totalPages; i++) {
            const li = document.createElement('li');
            li.className = `page-item ${i === currentPage ? 'active' : ''}`;
            const a = document.createElement('a');
            a.className = 'page-link';
            a.href = '#';
            a.textContent = i;
            a.dataset.page = i;
            li.appendChild(a);
            ul.appendChild(li);
        }
        paginationEl.appendChild(ul);
    }
    
    function handlePaginationClick(e) {
        e.preventDefault();
        if (e.target.matches('.page-link')) {
            const page = parseInt(e.target.dataset.page, 10);
            if (page !== currentPage) {
                currentPage = page;
                loadHistory();
            }
        }
    }

    function handleTableClick(e) {
        const target = e.target.closest('button');
        if (!target) return;

        const itemId = target.dataset.itemId;
        
        if (target.classList.contains('edit-btn')) {
            const tx = transactions.find(t => t.itemId === itemId);
            if (tx) {
                document.getElementById('editTxId').value = tx.txId;
                // The item ID is the txId + index, we need to extract the index
                const itemIndex = tx.itemId.split('_')[1];
                document.getElementById('editTxItemId').value = itemIndex;

                document.getElementById('editTxTimestamp').value = tx.timestamp;
                document.getElementById('editTxEmail').value = tx.email;
                document.getElementById('editTxItem').value = `${tx.name} (${tx.code})`;
                document.getElementById('editTxType').value = tx.type;
                document.getElementById('editTxQuantity').value = tx.quantity;
                document.getElementById('editTxNote').value = tx.note;
                
                // Convert DD/MM/YYYY to YYYY-MM-DD for date input
                const dateParts = tx.date.split('/');
                if(dateParts.length === 3) {
                    document.getElementById('editTxDate').value = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
                }

                editModal.show();
            }
        } else if (target.classList.contains('delete-btn')) {
            const tx = transactions.find(t => t.itemId === itemId);
            if(tx && confirm(`Bạn có chắc muốn xóa vật tư "${tx.name}" khỏi giao dịch ngày ${tx.date} không?`)) {
                const txId = tx.txId;
                const itemIndex = tx.itemId.split('_')[1];
                deleteTransaction(txId, itemIndex);
            }
        }
    }

    async function handleSaveChanges() {
        const txId = document.getElementById('editTxId').value;
        const itemIndex = document.getElementById('editTxItemId').value;

        const newData = {
            type: document.getElementById('editTxType').value,
            quantity: parseInt(document.getElementById('editTxQuantity').value, 10),
            note: document.getElementById('editTxNote').value,
            // Convert YYYY-MM-DD to DD/MM/YYYY before sending
            date: document.getElementById('editTxDate').value
        };

        if (!txId || itemIndex === null) {
            alert('Lỗi: Thiếu thông tin giao dịch.');
            return;
        }

        try {
            await callApi('/history/update', { txId, itemIndex, newData });
            alert('Cập nhật thành công!');
            editModal.hide();
            loadHistory();
        } catch (error) {
            console.error('Error updating transaction:', error);
            alert('Lỗi khi cập nhật: ' + error.message);
        }
    }

    async function deleteTransaction(txId, itemIndex) {
         if (!txId || itemIndex === null) {
            alert('Lỗi: Thiếu thông tin giao dịch.');
            return;
        }
        try {
            await callApi('/history/delete', { txId, itemIndex });
            alert('Xóa thành công!');
            loadHistory();
        } catch (error) {
            console.error('Error deleting transaction:', error);
            alert('Lỗi khi xóa: ' + error.message);
        }
    }
});
