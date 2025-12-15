// public/history.js
document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let transactions = [];
    let groupedTransactions = [];
    let currentPage = 1;
    let totalPages = 1;
    let allItems = [];
    const LIMIT = 50;
    let filterTimeout;

    const transactionEditorModal = new bootstrap.Modal(document.getElementById('transactionEditorModal'));
    let currentEditingTx = null;

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            document.getElementById('userEmailDisplay').innerText = user.email;
            initializePage();
        } else {
            window.location.href = 'index.html';
        }
    });

    function groupTransactions(flatList) {
        const groups = new Map();
        if (!flatList) return [];

        flatList.forEach(item => {
            const txId = item.txId || (item.itemId ? item.itemId.split('_')[0] : null);
            if (!txId) return;

            if (!groups.has(txId)) {
                groups.set(txId, {
                    txId: txId,
                    timestamp: item.timestamp,
                    date: item.date,
                    email: item.email,
                    type: item.type,
                    note: item.note, // Main note from the first item encountered
                    items: []
                });
            }
            groups.get(txId).items.push(item);
        });
        return Array.from(groups.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

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
        document.getElementById('saveTxChangesBtn').addEventListener('click', handleSaveTransactionChanges);
        document.getElementById('pagination').addEventListener('click', handlePaginationClick);
        document.getElementById('addNewItemBtn').addEventListener('click', handleAddNewItem);

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
            const itemSource = allItems.map(item => ({ label: `${item.name} (${item.code})`, value: item.code }));
            
            $("#itemFilter").autocomplete({
                source: itemSource,
                select: function(event, ui) {
                    event.preventDefault();
                    $(this).val(ui.item.value);
                    debouncedLoadHistory();
                }
            });

            $("#addNewItemInput").autocomplete({
                source: itemSource,
                select: function(event, ui) {
                    event.preventDefault();
                    $(this).val(ui.item.value);
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
            // Fetch a larger number of items to ensure full transactions are likely retrieved
            const response = await callApi('/history/list', { filters, page: 1, limit: 500 });
            transactions = response.transactions;
            groupedTransactions = groupTransactions(transactions);

            // Paginate on the client side
            totalPages = Math.ceil(groupedTransactions.length / LIMIT);
            currentPage = Math.min(currentPage, totalPages) || 1;
            
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
        
        const paginatedGroups = groupedTransactions.slice((currentPage - 1) * LIMIT, currentPage * LIMIT);

        if (paginatedGroups.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center">Không tìm thấy giao dịch nào.</td></tr>`;
            return;
        }

        paginatedGroups.forEach(tx => {
            const totalQty = tx.items.reduce((sum, item) => sum + item.quantity, 0);
            const mainRow = document.createElement('tr');
            mainRow.className = 'transaction-row';
            mainRow.dataset.txId = tx.txId;
            mainRow.innerHTML = `
                <td>${tx.timestamp}</td>
                <td>${tx.date}</td>
                <td>${tx.email}</td>
                <td><span class="badge ${tx.type === 'Mượn' ? 'bg-primary' : 'bg-success'}">${tx.type}</span></td>
                <td class="text-truncate" style="max-width: 150px;">${tx.note || ''}</td>
                <td>${tx.items.length}</td>
                <td>${totalQty}</td>
                <td>
                    <button class="btn btn-sm btn-outline-info expand-btn" title="Xem chi tiết"><i class="fas fa-chevron-down"></i></button>
                    <button class="btn btn-sm btn-outline-primary edit-tx-btn" title="Sửa giao dịch"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger delete-tx-btn" title="Xóa giao dịch"><i class="fas fa-trash"></i></button>
                </td>
            `;

            const detailsRow = document.createElement('tr');
            detailsRow.className = 'transaction-details-row';
            detailsRow.id = `details-${tx.txId}`;
            detailsRow.style.display = 'none';

            let detailsHtml = '<td colspan="8" class="p-0"><div class="p-3 bg-light">';
            detailsHtml += '<h6>Chi tiết vật tư:</h6><table class="table table-sm table-bordered mb-0"><thead><tr><th>Mã VT</th><th>Tên VT</th><th>SL</th><th>Đơn vị</th><th>Ghi chú</th></tr></thead><tbody>';
            tx.items.forEach(item => {
                detailsHtml += `
                    <tr>
                        <td>${item.code || ''}</td>
                        <td>${item.name || ''}</td>
                        <td>${item.quantity}</td>
                        <td>${item.unit || ''}</td>
                        <td>${item.note || ''}</td>
                    </tr>
                `;
            });
            detailsHtml += '</tbody></table></div></td>';
            detailsRow.innerHTML = detailsHtml;

            tableBody.appendChild(mainRow);
            tableBody.appendChild(detailsRow);
        });
    }

    function renderPagination() {
        const paginationEl = document.getElementById('pagination');
        paginationEl.innerHTML = '';
        if(totalPages <= 1) return;

        const ul = document.createElement('ul');
        ul.className = 'pagination';

        // Simplified pagination display logic
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);

        if (currentPage > 1) {
            ul.innerHTML += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage - 1}">&laquo;</a></li>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            ul.innerHTML += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }

        if (currentPage < totalPages) {
            ul.innerHTML += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage + 1}">&raquo;</a></li>`;
        }

        paginationEl.appendChild(ul);
    }
    
    function handlePaginationClick(e) {
        e.preventDefault();
        if (e.target.matches('.page-link')) {
            const page = parseInt(e.target.dataset.page, 10);
            if (page !== currentPage) {
                currentPage = page;
                renderTable(); // Re-render the same data with new page
                renderPagination();
            }
        }
    }

    function handleTableClick(e) {
        const target = e.target.closest('button');
        if (!target) return;

        const txRow = target.closest('.transaction-row');
        if (!txRow) return;

        const txId = txRow.dataset.txId;

        if (target.classList.contains('expand-btn')) {
            const detailsRow = document.getElementById(`details-${txId}`);
            const icon = target.querySelector('i');
            if (detailsRow.style.display === 'none') {
                detailsRow.style.display = '';
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-up');
            } else {
                detailsRow.style.display = 'none';
                icon.classList.remove('fa-chevron-up');
                icon.classList.add('fa-chevron-down');
            }
        } else if (target.classList.contains('edit-tx-btn')) {
            const transaction = groupedTransactions.find(t => t.txId === txId);
            if (transaction) openEditTransactionModal(transaction);
        } else if (target.classList.contains('delete-tx-btn')) {
            deleteEntireTransaction(txId);
        }
    }

    function openEditTransactionModal(transaction) {
        currentEditingTx = JSON.parse(JSON.stringify(transaction)); // Deep copy to avoid modifying original data
        
        document.getElementById('modalTxId').textContent = currentEditingTx.txId;
        document.getElementById('modalTxEmail').textContent = currentEditingTx.email;
        document.getElementById('modalTxDate').textContent = currentEditingTx.date;

        renderEditItems();
        
        transactionEditorModal.show();
    }

    function renderEditItems() {
        const itemsBody = document.getElementById('editItemsTableBody');
        itemsBody.innerHTML = '';
        if (!currentEditingTx || !currentEditingTx.items) return;

        currentEditingTx.items.forEach((item, index) => {
            const row = document.createElement('tr');
            row.dataset.index = index;
            row.dataset.id = item.id; // Assuming item has a unique ID
            row.innerHTML = `
                <td>${item.name} (${item.code})</td>
                <td><input type="number" class="form-control form-control-sm item-qty-input" value="${item.quantity}" min="1"></td>
                <td>${item.unit || ''}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger remove-item-btn" data-index="${index}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            itemsBody.appendChild(row);
        });
    }

    document.getElementById('editItemsTableBody').addEventListener('click', function(e) {
        if (e.target.closest('.remove-item-btn')) {
            const button = e.target.closest('.remove-item-btn');
            const indexToRemove = parseInt(button.dataset.index, 10);
            currentEditingTx.items.splice(indexToRemove, 1);
            renderEditItems(); // Re-render the list
        }
    });

    async function handleSaveTransactionChanges() {
        if (!currentEditingTx) return;

        const confirmed = confirm('Bạn có chắc muốn lưu các thay đổi vào giao dịch này không?');
        if (!confirmed) return;

        const spinner = document.getElementById('loadingSpinner');
        spinner.style.display = 'block';

        const updatedItems = [];
        const itemRows = document.getElementById('editItemsTableBody').querySelectorAll('tr');
        itemRows.forEach(row => {
            const index = parseInt(row.dataset.index, 10);
            const originalItem = currentEditingTx.items[index];
            const newQuantity = parseInt(row.querySelector('.item-qty-input').value, 10);

            if (originalItem && newQuantity > 0) {
                 updatedItems.push({
                    ...originalItem,
                    quantity: newQuantity,
                 });
            }
        });
        currentEditingTx.items = updatedItems;

        try {
            await callApi('/history/updateTransaction', {
                txId: currentEditingTx.txId,
                updatedItems: currentEditingTx.items
            });

            transactionEditorModal.hide();
            spinner.style.display = 'none';
            alert('Cập nhật giao dịch thành công!');
            loadHistory();
        } catch (error) {
            spinner.style.display = 'none';
            console.error('Error saving transaction changes:', error);
            alert('Lỗi khi lưu thay đổi: ' + error.message);
        }
    }
     function handleAddNewItem() {
        const itemCode = $('#addNewItemInput').val();
        const itemQty = parseInt($('#addNewItemQty').val(), 10);

        if (!itemCode || isNaN(itemQty) || itemQty <= 0) {
            alert('Vui lòng chọn một vật tư và nhập số lượng hợp lệ.');
            return;
        }

        const selectedItem = allItems.find(i => i.code === itemCode);
        if (!selectedItem) {
            alert('Vật tư không hợp lệ.');
            return;
        }
        
        const isAlreadyInTx = currentEditingTx.items.some(i => i.code === selectedItem.code);
        if(isAlreadyInTx) {
            alert('Vật tư này đã có trong giao dịch. Vui lòng cập nhật số lượng trực tiếp.');
            return;
        }

        currentEditingTx.items.push({
            // Structure of a new item might be different, adjust as needed
            // This assumes a structure similar to existing items
            id: selectedItem.id, // This might need to be generated or handled server-side
            code: selectedItem.code,
            name: selectedItem.name,
            quantity: itemQty,
            unit: selectedItem.unit,
            note: 'Hàng thêm mới', // Default note for new items
            // Essential fields for a transaction item
            txId: currentEditingTx.txId,
            email: currentEditingTx.email,
            date: currentEditingTx.date,
            timestamp: currentEditingTx.timestamp,
            type: currentEditingTx.type,
        });

        renderEditItems();

        // Clear inputs
        $('#addNewItemInput').val('');
        $('#addNewItemQty').val(1);
    }

    async function deleteEntireTransaction(txId) {
        if (!txId) {
            alert('Lỗi: Thiếu thông tin giao dịch.');
            return;
        }

        if (!confirm(`Bạn có chắc muốn XÓA TOÀN BỘ giao dịch này không? Hành động này không thể hoàn tác.`)) {
            return;
        }

        try {
            // Assume a new endpoint for deleting the whole transaction
            await callApi('/history/deleteTransaction', { txId });
            alert('Xóa toàn bộ giao dịch thành công!');
            // Reset to page 1 and reload
            currentPage = 1;
            loadHistory();
        } catch (error) {
            console.error('Error deleting transaction:', error);
            alert('Lỗi khi xóa giao dịch: ' + error.message);
        }
    }
});
