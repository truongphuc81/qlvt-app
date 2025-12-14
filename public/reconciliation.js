document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            document.getElementById('userEmailDisplay').innerText = user.email;
            initializePage();
        } else {
            window.location.href = 'index.html';
        }
    });

    const editModal = new bootstrap.Modal(document.getElementById('editTicketModal'));
    const monthFilter = document.getElementById('monthFilter');
    const emailFilter = document.getElementById('emailFilter');
    const statusFilter = document.getElementById('statusFilter');
    const ticketSearch = document.getElementById('ticketSearch');

    let allTickets = [];
    let allItems = [];
    let currentEditingTicket = null;

    function initializePage() {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        monthFilter.value = `${year}-${month}`;

        loadInitialData();
        loadTechnicians();

        monthFilter.addEventListener('change', () => {
            const selectedMonth = monthFilter.value;
            loadTickets(selectedMonth);
        });
        
        emailFilter.addEventListener('change', applyAndRenderFilters);
        statusFilter.addEventListener('change', applyAndRenderFilters);
        ticketSearch.addEventListener('input', applyAndRenderFilters);
    }

    async function loadInitialData() {
        const selectedMonth = monthFilter.value;
        await Promise.all([
            loadTickets(selectedMonth),
            loadInventory()
        ]);
    }

    async function loadTickets(month) {
        const spinner = document.getElementById('loadingSpinner');
        spinner.style.display = 'block';
        document.getElementById('ticketsTableBody').innerHTML = '';
        try {
            allTickets = await callApi('/reconciliation/tickets', { month });
            applyAndRenderFilters();
        } catch (error) {
            console.error('Error loading tickets:', error);
            alert('Không thể tải dữ liệu sổ. Vui lòng thử lại.');
        } finally {
            spinner.style.display = 'none';
        }
    }
    
    async function loadTechnicians() {
        try {
            const technicians = await callApi('/public/technicians', {});
            emailFilter.innerHTML = '<option value="">Tất cả KTV</option>'; // Reset
            technicians.forEach(tech => {
                const option = document.createElement('option');
                option.value = tech.email;
                option.textContent = `${tech.name} (${tech.email})`;
                emailFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading technicians:', error);
        }
    }

    async function loadInventory() {
        try {
            allItems = await callApi('/inventory/list', {});
            $("#newItemCode").autocomplete({
                source: allItems.map(item => ({ label: `${item.name} (${item.code})`, value: item.code, name: item.name })),
                select: function(event, ui) {
                    event.preventDefault();
                    $(this).val(ui.item.value);
                    $('#newItemName').val(ui.item.name);
                }
            });
        } catch (e) {
            console.error("Lỗi tải danh mục vật tư:", e);
        }
    }

    function applyAndRenderFilters() {
        const email = emailFilter.value;
        const status = statusFilter.value;
        const searchTerm = ticketSearch.value.toLowerCase();

        const filteredTickets = allTickets.filter(ticket => {
            const emailMatch = !email || ticket.email === email;
            const statusMatch = !status || ticket.status === status;
            const searchMatch = !searchTerm || ticket.ticket.toLowerCase().includes(searchTerm);
            return emailMatch && statusMatch && searchMatch;
        });

        renderTickets(filteredTickets);
    }

    function renderTickets(tickets) {
        const tableBody = document.getElementById('ticketsTableBody');
        tableBody.innerHTML = '';
        if (!tickets || tickets.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Không tìm thấy dữ liệu phù hợp.</td></tr>';
            return;
        }
        tickets.forEach(ticket => {
            const tr = document.createElement('tr');
            const statusClass = ticket.status === 'Đã đối chiếu' ? 'bg-success' : 'bg-warning text-dark';
            tr.innerHTML = `
                <td>${ticket.ticket}</td>
                <td>${ticket.date}</td>
                <td>${ticket.email}</td>
                <td>${ticket.items.length}</td>
                <td><span class="badge ${statusClass}">${ticket.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-primary edit-btn" data-ticket-id="${ticket.ticket}">Sửa</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-ticket-id="${ticket.ticket}">Xóa</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }
    
    function renderTicketItems(items) {
        const tableBody = document.getElementById('ticketItemsTableBody');
        tableBody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.dataset.docId = item.docId;
            tr.innerHTML = `
                <td>${item.itemCode}</td>
                <td>${item.itemName}</td>
                <td><input type="number" class="form-control form-control-sm item-quantity-input" value="${item.quantity}" min="1"></td>
                <td><button class="btn btn-sm btn-outline-danger delete-item-btn">Xóa</button></td>
            `;
            tableBody.appendChild(tr);
        });
    }

    document.getElementById('ticketsTableBody').addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const ticketId = e.target.dataset.ticketId;
            currentEditingTicket = allTickets.find(t => t.ticket === ticketId);
            if (currentEditingTicket) {
                document.getElementById('modalTicketId').innerText = ticketId;
                renderTicketItems(currentEditingTicket.items);
                editModal.show();
            }
        }
        if (e.target.classList.contains('delete-btn')) {
            const ticketId = e.target.dataset.ticketId;
            if (confirm(`Bạn có chắc chắn muốn xóa toàn bộ sổ "${ticketId}" không?`)) {
                handleDeleteTicket(ticketId);
            }
        }
    });
    
    document.getElementById('ticketItemsTableBody').addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-item-btn')) {
            const row = e.target.closest('tr');
            const docId = row.dataset.docId;
            if (confirm('Bạn có chắc muốn xóa vật tư này?')) {
                try {
                    await callApi(`/reconciliation/item/delete/${docId}`, {});
                    row.remove();
                    currentEditingTicket.items = currentEditingTicket.items.filter(item => item.docId !== docId);
                    applyAndRenderFilters(); // Re-render the main table
                } catch (error) {
                    console.error('Error deleting item:', error);
                    alert('Lỗi khi xóa vật tư: ' + error.message);
                }
            }
        }
    });

    document.getElementById('saveChangesBtn').addEventListener('click', async () => {
        const rows = document.querySelectorAll('#ticketItemsTableBody tr');
        const updates = [];
        rows.forEach(row => {
            const docId = row.dataset.docId;
            const newQuantity = row.querySelector('.item-quantity-input').value;
            const originalItem = currentEditingTicket.items.find(item => item.docId === docId);
            if (originalItem && Number(originalItem.quantity) !== Number(newQuantity)) {
                updates.push({ docId, quantity: newQuantity });
            }
        });

        if (updates.length > 0) {
            try {
                await Promise.all(updates.map(update => 
                    callApi(`/reconciliation/item/update/${update.docId}`, { quantity: update.quantity })
                ));
                alert('Cập nhật số lượng thành công!');
                updates.forEach(update => {
                    const item = currentEditingTicket.items.find(i => i.docId === update.docId);
                    if(item) item.quantity = update.quantity;
                });
                applyAndRenderFilters();
            } catch (error) {
                console.error('Error updating quantities:', error);
                alert('Lỗi khi cập nhật số lượng: ' + error.message);
            }
        }
        editModal.hide();
    });

    document.getElementById('addItemBtn').addEventListener('click', async () => {
        if (!currentEditingTicket) return;
        const newItem = {
            ticket: currentEditingTicket.ticket,
            date: currentEditingTicket.date,
            email: currentEditingTicket.email,
            status: currentEditingTicket.status,
            itemCode: document.getElementById('newItemCode').value,
            itemName: document.getElementById('newItemName').value,
            quantity: document.getElementById('newItemQuantity').value
        };

        if (!newItem.itemCode || !newItem.quantity) {
            alert('Vui lòng nhập đầy đủ thông tin vật tư mới.');
            return;
        }

        try {
            const result = await callApi('/reconciliation/item', newItem);
            newItem.docId = result.docId;
            currentEditingTicket.items.push(newItem);
            renderTicketItems(currentEditingTicket.items);
            applyAndRenderFilters();
            document.getElementById('newItemCode').value = '';
            document.getElementById('newItemName').value = '';
            document.getElementById('newItemQuantity').value = '1';
        } catch (error) {
            console.error('Error adding item:', error);
            alert('Lỗi khi thêm vật tư: ' + error.message);
        }
    });

    async function handleDeleteTicket(ticketId) {
        try {
            await callApi(`/reconciliation/ticket/delete/${ticketId}`, {});
            allTickets = allTickets.filter(t => t.ticket !== ticketId);
            applyAndRenderFilters();
            alert(`Đã xóa thành công sổ ${ticketId}`);
        } catch (error) {
            console.error(`Error deleting ticket ${ticketId}:`, error);
            alert(`Lỗi khi xóa sổ ${ticketId}: ` + error.message);
        }
    }
});
