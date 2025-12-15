// public/borrow-return.js

// === GLOBAL VARIABLES ===
let systemInventory = {};
let cart = []; // [{ id, code, name, unit, serial }]
let currentMode = 'borrow'; // 'borrow' | 'return'
let currentSource = 'DIRECT'; // 'DIRECT' | 'PENDING'
let pendingNotesMap = {}; // Cache phiếu chờ của KTV đang chọn
let currentPendingId = null; // ID phiếu đang chọn duyệt
let html5QrCode = null;
let beepAudio = new Audio('chime.mp3');
let technicianData = []; // Cache a list of technician objects {email, name, avatarUrl}
let technicianMap = new Map(); // To map email to name for notifications

// Realtime listeners
let pendingBorrowListener = null;
let pendingReturnListener = null;
let allPendingBorrows = [];
let allPendingReturns = [];

// History Section Globals
let technicianHistoryListener = null;
let technicianHistoryCache = [];
let technicianHistoryLastDoc = null;
const HISTORY_PAGE_SIZE = 10;


// === INIT ===
document.addEventListener('DOMContentLoaded', async function() {
    // NOTE: firebase.firestore() is available globally from scripts in borrow-return.html
    const db = firebase.firestore();

    auth.onAuthStateChanged(async user => {
        if (!user) { window.location.href = 'index.html'; return; }
        
        const roles = await callApi('/auth/getSelfRoles', {});
        if (!roles.admin && !roles.inventory_manager && !roles.sale) {
            alert("Không có quyền truy cập.");
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('userEmailDisplay').innerText = user.email;
        
        // Load essential data first
        await Promise.all([ 
            loadTechnicians(), 
            loadInventory(),
        ]);
        
        // Setup initial state for quantity input - REMOVED
        // toggleQtyInput();
        
        focusInput();
    });

    // Scanner Listener
    document.getElementById('scanInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') processScan();
    });
    
    // Auto Qty checkbox listener - REMOVED
    // document.getElementById('autoQty').addEventListener('change', toggleQtyInput);

    // History filter listener
    document.getElementById('historyFilterType').addEventListener('change', () => {
        const email = document.getElementById('techSelect').value;
        if (email) {
            // Detach old listener and start a new one with the new filter
            if (technicianHistoryListener) technicianHistoryListener();
            listenForTechnicianHistory(email);
        }
    });

    // History load more listener
    document.getElementById('loadMoreTechnicianHistory').addEventListener('click', () => {
         const email = document.getElementById('techSelect').value;
         if(email) loadMoreTechnicianHistory(email);
    });
});

// Focus Helper
function focusInput() {
    if (!Swal.isVisible()) document.getElementById('scanInput').focus();
}
document.addEventListener('click', (e) => {
    if (!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName) && !e.target.closest('.ui-autocomplete')) {
        focusInput();
    }
});

// === 1. REAL-TIME NOTIFICATIONS & DATA LOADING ===

function setupRealtimePendingNotesListener(db) {
    if (pendingBorrowListener) pendingBorrowListener();
    if (pendingReturnListener) pendingReturnListener();

    const borrowQuery = db.collection('pending_notes')
        .where('isFulfilled', '==', false)
        .where('status', 'not-in', ['Rejected']);

    pendingBorrowListener = borrowQuery.onSnapshot(snapshot => {
        allPendingBorrows = snapshot.docs.map(doc => doc.data());
        combineAndRenderAllPending();
    }, err => {
        console.error("Lỗi listener phiếu mượn chờ:", err);
        showErrorInNotificationMenu("Lỗi tải phiếu mượn");
    });

    const returnQuery = db.collection('pending_return_notes')
        .where('isFulfilled', '==', false)
        .where('status', 'not-in', ['Rejected']);

    pendingReturnListener = returnQuery.onSnapshot(snapshot => {
        allPendingReturns = snapshot.docs.map(doc => doc.data());
        combineAndRenderAllPending();
    }, err => {
        console.error("Lỗi listener phiếu trả chờ:", err);
        showErrorInNotificationMenu("Lỗi tải phiếu trả");
    });
}

function combineAndRenderAllPending() {
    let allPending = [...allPendingBorrows, ...allPendingReturns];
    allPending.forEach(note => {
        note.name = technicianMap.get(note.email) || note.email.split('@')[0];
    });
    allPending.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderPendingNotificationsUI(allPending);
}

function renderPendingNotificationsUI(allPending) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    menu.innerHTML = ''; 
    
    if (allPending && allPending.length > 0) {
        badge.innerText = allPending.length;
        badge.style.display = 'block';

        allPending.forEach(note => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'dropdown-item';
            a.href = '#';
            const techName = note.name;
            const itemQty = note.items ? note.items.length : 0;
            const noteType = note.type === 'Mượn' ? 'mượn' : 'trả';

            let noteContentHtml = '';
            if (note.note && note.note.trim() !== '') {
                const truncatedNote = note.note.length > 35 ? note.note.substring(0, 32) + '...' : note.note;
                noteContentHtml = `<div class="small text-dark" style="white-space: normal;">Ghi chú: "${truncatedNote}"</div>`;
            } else if (itemQty > 0) {
                noteContentHtml = `<div class="small text-muted">Yêu cầu ${noteType} ${itemQty} món</div>`;
            } else {
                noteContentHtml = `<div class="small text-muted">Yêu cầu ${noteType} (chi tiết trống)</div>`;
            }

            a.innerHTML = `
                <div class="fw-bold">${techName}</div>
                ${noteContentHtml}
                <div class="small text-muted fst-italic">${new Date(note.timestamp).toLocaleString('vi-VN')}</div>
            `;
            a.onclick = () => handleNotificationClick(note.email, note.timestamp, note.type);
            li.appendChild(a);
            menu.appendChild(li);
        });
    } else {
        badge.style.display = 'none';
        menu.innerHTML = '<li><a class="dropdown-item disabled" href="#">Không có thông báo mới</a></li>';
    }
}

function showErrorInNotificationMenu(message) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    badge.style.display = 'none';
    menu.innerHTML = `<li><a class="dropdown-item text-danger" href="#">${message}</a></li>`;
}

async function handleNotificationClick(email, timestamp, type) {
    const targetMode = type === 'Mượn' ? 'borrow' : 'return';
    if (currentMode !== targetMode) {
        document.getElementById(targetMode === 'borrow' ? 'radioBorrow' : 'radioReturn').checked = true;
        setMode(targetMode);
    }
    const techSelect = document.getElementById('techSelect');
    techSelect.value = email;
    techSelect.dispatchEvent(new Event('change'));
    await checkPending(email);
    const pendingSelect = document.getElementById('pendingSelect');
    if (pendingSelect.querySelector(`option[value="${timestamp}"]`)) {
        pendingSelect.value = timestamp;
        document.getElementById('sourcePending').checked = true;
        toggleOrderSource();
    }
}

async function loadTechnicians() {
    try {
        const techs = await callApi('/public/technicians');
        technicianData = techs || [];
        const select = document.getElementById('techSelect');
        select.innerHTML = '<option value="">-- Chọn Kỹ Thuật Viên --</option>';
        technicianMap.clear();
        technicianData.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.email;
            opt.text = `${t.name} (${t.email})`;
            select.appendChild(opt);
            technicianMap.set(t.email, t.name);
        });

        select.addEventListener('change', async function() {
            const email = this.value;
            const avatarImg = document.getElementById('techAvatar');

            // Detach old history listener
            if (technicianHistoryListener) {
                technicianHistoryListener();
                technicianHistoryListener = null;
            }
            document.getElementById('technicianHistoryBody').innerHTML = '<tr><td colspan="3" class="text-center text-muted">Chọn một KTV để xem lịch sử.</td></tr>';
            document.getElementById('loadMoreTechnicianHistory').style.display = 'none';


            if (email) {
                const selectedTech = technicianData.find(t => t.email === email);
                if (selectedTech && avatarImg) {
                    avatarImg.src = selectedTech.avatarUrl || '/default-avatar.png';
                    avatarImg.style.display = 'inline-block';
                }
                // Load pending tickets for this tech AND their history
                await checkPending(email);
                listenForTechnicianHistory(email); // Start listening for history
            } else {
                if (avatarImg) avatarImg.style.display = 'none';
                resetPendingUI();
            }
        });
    } catch (e) {
        console.error("Lỗi tải danh sách KTV:", e);
    }
}

async function loadInventory() {
    try {
        const list = await callApi('/inventory/list', {});
        systemInventory = {};
        list.forEach(i => systemInventory[i.code] = { name: i.name, unit: i.unit });
        initItemSearch(); 
    } catch(e) { console.error("Lỗi tải danh mục vật tư:", e); }
}

function initItemSearch() {
    const source = Object.keys(systemInventory).map(code => ({
        label: `${systemInventory[code].name} (${code})`, value: code, name: systemInventory[code].name, unit: systemInventory[code].unit
    }));
    $("#scanInput").autocomplete({
        source: source, minLength: 1, 
        select: function(event, ui) {
            event.preventDefault(); 
            handleAddItem(ui.item.value, { name: ui.item.name, unit: ui.item.unit });
            $(this).val('');
        },
        open: function() { $(this).autocomplete("widget").addClass("custom-autocomplete-menu"); }
    });
}

// === 2. PENDING TICKETS LOGIC (Per Technician) ===
let checkPendingPromise = null;
async function checkPending(email) {
    if (checkPendingPromise) return checkPendingPromise;
    checkPendingPromise = (async () => {
        try {
            resetPendingUI();
            const endpoint = currentMode === 'borrow' ? '/manager/pending-borrow-notes' : '/manager/pending-return-notes';
            const notes = await callApi(endpoint, { email: email });
            if (notes.length > 0) {
                document.getElementById('pendingOptionDiv').style.display = 'block';
                document.getElementById('pendingCount').innerText = notes.length;
                const select = document.getElementById('pendingSelect');
                pendingNotesMap = {};
                notes.forEach(n => {
                    pendingNotesMap[n.timestamp] = n;
                    const d = new Date(n.timestamp).toLocaleString('vi-VN');
                    const opt = document.createElement('option');
                    opt.value = n.timestamp;
                    const noteContent = n.items && n.items.length > 0 ? `${n.items.length} món` : (n.note || 'Trống');
                    opt.text = `${d} - ${noteContent}`;
                    select.appendChild(opt);
                });
            }
        } catch (e) { 
            console.warn(`Lỗi khi tải phiếu chờ (${currentMode}):`, e); 
        } finally {
            checkPendingPromise = null;
        }
    })();
    return checkPendingPromise;
}

function resetPendingUI() {
    document.getElementById('pendingOptionDiv').style.display = 'none';
    document.getElementById('pendingSelect').style.display = 'none';
    document.getElementById('btnRejectPending').style.display = 'none';
    document.getElementById('pendingSelect').innerHTML = '<option value="">-- Chọn phiếu --</option>';
    document.getElementById('sourceDirect').checked = true;
    currentSource = 'DIRECT';
    currentPendingId = null;
    clearCart();
}

function toggleOrderSource() {
    currentSource = document.querySelector('input[name="orderSource"]:checked').value;
    const pendingSelect = document.getElementById('pendingSelect');
    const directOptionDiv = document.getElementById('directOptionDiv');
    const pendingCheckDiv = document.getElementById('pendingOptionDiv').querySelector('.form-check');
    const rejectBtn = document.getElementById('btnRejectPending');

    if (currentSource === 'PENDING') {
        pendingSelect.style.display = 'block';
        directOptionDiv.classList.remove('source-direct-selected');
        if (pendingCheckDiv) pendingCheckDiv.classList.add('source-pending-selected');
        if (pendingSelect.value) {
            loadPendingTicket();
        } else {
             rejectBtn.style.display = 'none';
        }
    } else {
        pendingSelect.style.display = 'none';
        rejectBtn.style.display = 'none';
        directOptionDiv.classList.add('source-direct-selected');
        if (pendingCheckDiv) pendingCheckDiv.classList.remove('source-pending-selected');
        clearCart(); 
        currentPendingId = null;
        document.getElementById('transactionNote').value = '';
        document.getElementById('transactionNote').classList.remove('note-highlight');
    }
    focusInput();
}

function loadPendingTicket() {
    const id = document.getElementById('pendingSelect').value;
    const transactionNoteEl = document.getElementById('transactionNote');
    const rejectBtn = document.getElementById('btnRejectPending');

    if (!id) {
        clearCart();
        transactionNoteEl.value = '';
        transactionNoteEl.classList.remove('note-highlight');
        rejectBtn.style.display = 'none';
        return;
    }
    
    rejectBtn.style.display = 'inline-block';

    const note = pendingNotesMap[id];
    if (!note) return;

    currentPendingId = id;
    cart = []; // Reset cart
    (note.items || []).forEach(i => {
        const info = systemInventory[i.code] || { name: i.name, unit: 'Cái' };
        cart.push({
            ...info,
            code: i.code,
            id: i.code, // Use code as the unique ID for the grouped item
            quantity: parseInt(i.quantity) || 1,
            serials: i.serials || [] // Load serials if they exist on the pending note
        });
    });

    transactionNoteEl.value = note.note || '';
    if (note.note && note.note.trim() !== '') {
        transactionNoteEl.classList.add('note-highlight');
    } else {
        transactionNoteEl.classList.remove('note-highlight');
    }
    renderCart();
    Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Đã tải phiếu chờ', showConfirmButton: false, timer: 1500 });
}

// === 3. MODE & UI LOGIC ===

function setMode(mode) {
    currentMode = mode;
    const body = document.body;
    const directLabel = document.getElementById('directLabel');
    const title = document.getElementById('listTitle');
    const btn = document.getElementById('btnSubmit');
    if (mode === 'borrow') {
        body.classList.remove('mode-return'); body.classList.add('mode-borrow');
        directLabel.innerText = "Quét Mượn Trực Tiếp"; title.innerText = "DANH SÁCH MƯỢN"; btn.innerText = "XÁC NHẬN MƯỢN";
    } else {
        body.classList.remove('mode-borrow'); body.classList.add('mode-return');
        directLabel.innerText = "Quét Trả Trực Tiếp"; title.innerText = "DANH SÁCH TRẢ"; btn.innerText = "XÁC NHẬN TRẢ";
    }
    const email = document.getElementById('techSelect').value;
    if (email) checkPending(email); else resetPendingUI();
}

// === 4. SCANNING & CART LOGIC ===

async function handleAddItem(code, item) {
    const autoQty = document.getElementById('autoQty').checked;
    if (autoQty) {
        addToCart(code, item, 1);
        beepAudio.currentTime = 0; beepAudio.play().catch(()=>{});
        Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 800 }).fire({ icon: 'success', title: item.name });
    } else {
        const { value: quantity } = await Swal.fire({
            title: `Nhập số lượng cho ${item.name}`,
            input: 'number',
            inputAttributes: {
                min: 1,
                step: 1
            },
            inputValue: 1,
            showCancelButton: true,
            confirmButtonText: 'Xác nhận'
        });

        if (quantity && parseInt(quantity) > 0) {
            addToCart(code, item, parseInt(quantity));
            beepAudio.currentTime = 0; beepAudio.play().catch(()=>{});
            Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 800 }).fire({ icon: 'success', title: item.name });
        }
    }
}

function processScan() {
    const input = document.getElementById('scanInput');
    const rawCode = input.value.trim();
    if (!rawCode) return;

    const item = systemInventory[rawCode];
    if (item) {
        handleAddItem(rawCode, item);
    } else {
        Swal.fire('Lỗi', `Mã "${rawCode}" không tồn tại`, 'error');
    }
    input.value = '';
    focusInput();
}

function addToCart(code, item, quantityToAdd) {
    const existingItem = cart.find(i => i.code === code);

    if (existingItem) {
        existingItem.quantity += quantityToAdd;
    } else {
        const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        cart.push({ 
            ...item, 
            code: code, 
            id: uniqueId, // Keep a unique ID for potential future use, though code is the primary key now
            quantity: quantityToAdd,
            serials: [] // Initialize serials array
        });
    }
    
    renderCart();
    focusInput();
}


function renderCart() {
    const tbody = document.getElementById('cartBody');
    const thead = document.querySelector('#cartTable thead tr');
    tbody.innerHTML = '';

    // Adjust header for new structure
    thead.innerHTML = `
        <th style="width: 50px;">#</th>
        <th>Mã Hàng</th>
        <th>Tên Vật Tư</th>
        <th style="width: 100px;">Số lượng</th>
        <th style="width: 200px;">Số Serial (nếu có)</th>
        <th class="text-center" style="width: 80px;">Đơn vị</th>
        <th style="width: 50px;"></th>
    `;

    let totalItems = 0;
    cart.forEach((it, idx) => {
        const tr = document.createElement('tr');
        // Join serials array into a comma-separated string for the textarea
        const serialsString = it.serials ? it.serials.join(', ') : '';
        
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td class="fw-bold text-primary">${it.code}</td>
            <td>${it.name}</td>
            <td><input type="number" class="form-control form-control-sm" value="${it.quantity}" data-code="${it.code}" onchange="updateQuantity(this)" min="1"></td>
            <td><textarea class="form-control form-control-sm" data-code="${it.code}" onchange="updateSerials(this)" placeholder="Nhập các serial, cách nhau bằng dấu phẩy">${serialsString}</textarea></td>
            <td class="text-center">${it.unit}</td>
            <td><button class="btn btn-sm text-danger" onclick="delItem('${it.code}')"><i class="fas fa-times"></i></button></td>`;
        tbody.appendChild(tr);
        totalItems += it.quantity;
    });

    document.getElementById('totalQtyBadge').innerText = `${totalItems} món`;
    if (cart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted">Vui lòng chọn KTV và quét mã...</td></tr>';
    }
}

function updateQuantity(input) {
    const code = input.dataset.code;
    const quantity = parseInt(input.value);
    const item = cart.find(i => i.code === code);
    if (item) {
        if (quantity > 0) {
            item.quantity = quantity;
        } else {
            // If quantity is 0 or less, remove the item
            delItem(code);
        }
    }
    renderCart(); // Re-render to update total count
}

function updateSerials(textarea) {
    const code = textarea.dataset.code;
    const serialsString = textarea.value.trim();
    const item = cart.find(i => i.code === code);
    if (item) {
        // Split by comma, trim whitespace from each serial, and filter out empty strings
        item.serials = serialsString ? serialsString.split(',').map(s => s.trim()).filter(s => s) : [];
    }
}

function delItem(code) {
    cart = cart.filter(i => i.code !== code);
    renderCart();
}

function clearCart() { 
    cart = []; 
    renderCart(); 
    focusInput(); 
}

// === 5. SUBMIT & REJECT ===

async function submitTransaction() {
    const email = document.getElementById('techSelect').value;
    const note = document.getElementById('transactionNote').value;
    const submitBtn = document.getElementById('btnSubmit');
    if (!email) return Swal.fire('Thiếu thông tin', 'Chưa chọn Kỹ thuật Viên', 'warning');
    if (cart.length === 0) return Swal.fire('Trống', 'Chưa quét vật tư nào', 'warning');

    // With the new cart structure, we just need to map it. No more grouping needed.
    const items = cart.map(item => {
        const itemPayload = {
            code: item.code,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit
        };
        // Only add serials array if it's not empty
        if (item.serials && item.serials.length > 0) {
            // Ensure the number of serials matches the quantity
            if (item.serials.length !== item.quantity) {
                 throw new Error(`Số lượng serials (${item.serials.length}) không khớp với số lượng vật tư (${item.quantity}) cho mã ${item.code}.`);
            }
            itemPayload.serials = item.serials;
        }
        // For return mode, specify the quantity being returned
        if (currentMode === 'return') {
            itemPayload.quantityReturned = item.quantity;
        }
        return itemPayload;
    });

    let modeAPI;
    if (currentSource === 'PENDING' && currentPendingId) {
        if (currentMode === 'borrow') modeAPI = 'NOTE';
    } else {
        modeAPI = currentMode === 'borrow' ? 'DIRECT' : 'MANAGER_DIRECT';
    }
    
    const payload = {
        email: email, type: currentMode === 'borrow' ? 'Mượn' : 'Trả', mode: modeAPI,
        date: new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}),
        timestamp: new Date().toISOString(), items: items, note: note,
        borrowTimestamp: (currentMode === 'borrow' && currentSource === 'PENDING') ? currentPendingId : undefined,
        returnTimestamp: (currentMode === 'return' && currentSource === 'PENDING') ? currentPendingId : undefined
    };

    const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
    const actionName = currentMode === 'borrow' ? 'XUẤT MƯỢN' : 'NHẬP TRẢ';
    const result = await Swal.fire({ title: `Xác nhận ${actionName}`, html: `Cho KTV: <b>${email}</b><br>Tổng số lượng: <b>${totalQty} món</b>`, icon: 'question', showCancelButton: true, confirmButtonText: 'Đồng ý' });
    
    if (result.isConfirmed) {
        submitBtn.disabled = true;
        Swal.fire({ title: 'Đang xử lý...', text: 'Vui lòng chờ trong giây lát.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        try {
            const apiEndpoint = currentMode === 'borrow' ? '/manager/submitBorrow' : '/manager/submitReturn';
            await callApi(apiEndpoint, payload);
            await Swal.fire('Thành công', 'Giao dịch đã được lưu', 'success');
            clearCart();
            document.getElementById('transactionNote').value = '';
            document.getElementById('transactionNote').classList.remove('note-highlight');
            await checkPending(email);
        } catch (e) {
            Swal.fire('Lỗi', e.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    }
}


async function rejectPendingTransaction() {
    const email = document.getElementById('techSelect').value;
    if (!currentPendingId || !email) {
        return Swal.fire('Lỗi', 'Không có phiếu chờ nào được chọn.', 'error');
    }

    const { value: reason } = await Swal.fire({
        title: 'Từ chối yêu cầu',
        input: 'text',
        inputLabel: 'Lý do từ chối',
        inputPlaceholder: 'VD: Không đủ hàng, yêu cầu không hợp lệ...',
        showCancelButton: true,
        confirmButtonText: 'Xác nhận Từ chối',
        cancelButtonText: 'Hủy',
        inputValidator: (value) => {
            if (!value) {
                return 'Bạn phải nhập lý do từ chối!';
            }
        }
    });

    if (reason) {
        Swal.fire({ title: 'Đang xử lý...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const payload = {
            email: email,
            timestamp: currentPendingId,
            reason: reason
        };
        const endpoint = currentMode === 'borrow' ? '/manager/rejectBorrowNote' : '/manager/rejectReturnNote';

        try {
            await callApi(endpoint, payload);
            await Swal.fire('Thành công', 'Đã từ chối yêu cầu.', 'success');
            
            // Reset UI
            clearCart();
            document.getElementById('transactionNote').value = '';
            document.getElementById('transactionNote').classList.remove('note-highlight');
            
            // Reload pending list for the technician
            await checkPending(email);
        } catch (e) {
            Swal.fire('Lỗi', `Không thể từ chối yêu cầu: ${e.message}`, 'error');
        }
    }
}


// === 6. CAMERA ===
function toggleCamera() {
    const box = document.getElementById('cameraSection');
    if (box.style.display === 'none') {
        box.style.display = 'block';
        if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (txt) => { document.getElementById('scanInput').value = txt; processScan(); }, () => {}).catch(err => console.error("QR Code scanner failed to start.", err));
    } else {
        box.style.display = 'none';
        if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => console.log("QR Code scanner stopped.")).catch(err => console.error("QR Code scanner failed to stop.", err)); }
    }
}

// === 7. TECHNICIAN HISTORY SECTION (NEW) ===

function formatTransactionHistoryContent(doc) {
    let html = '';
    let statusHtml = '';
    if (doc.status === 'Pending') {
        statusHtml = `<span class="badge bg-primary">Đang chờ</span><br>`;
    } else if (doc.status === 'Rejected') {
        let reason = doc.rejectionReason ? `: ${doc.rejectionReason}` : '';
        statusHtml = `<span class="badge bg-danger">Bị từ chối${reason}</span><br>`;
    } else if (doc.status === 'Fulfilled') {
         statusHtml = `<span class="badge bg-success">Hoàn thành</span><br>`;
    }

    let noteDisplay = (doc.status === 'Rejected' && doc.note) ? `<s>${doc.note}</s>` : doc.note;
    if (noteDisplay) {
        html += `<div class="history-note"><strong>Ghi chú:</strong> ${noteDisplay}</div>`;
    }
    html += statusHtml;

    if (doc.items && doc.items.length > 0) {
        html += `<small class="text-muted">`;
        doc.items.forEach(item => {
            const itemInfo = systemInventory[item.code];
            const unit = item.unit || (itemInfo ? itemInfo.unit : ''); // Lấy đơn vị từ item, fallback về inventory
            let itemText = `&bull; ${item.name || item.code}: ${item.quantity} ${unit}`;
            // Display serials if they exist
            if (item.serials && item.serials.length > 0) {
                itemText += ` (Serials: ${item.serials.join(', ')})`;
            }
            html += itemText + '<br>';
        });
        html += `</small>`;
    }
    return html;
}

function renderTechnicianHistoryTable() {
    const tbody = document.getElementById('technicianHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filteredCache = technicianHistoryCache.filter(doc => doc.note !== 'Điều chỉnh kho âm (Tự động)');

    if (filteredCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Không có dữ liệu.</td></tr>';
        return;
    }
    
    filteredCache.forEach(doc => {
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'text-primary' : 'text-success';
        tr.innerHTML = `
            <td data-label="Thời gian"><small>${timestamp}</small></td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatTransactionHistoryContent(doc)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function listenForTechnicianHistory(email) {
    if (!email) return;
    if (technicianHistoryListener) technicianHistoryListener(); // Detach old one

    technicianHistoryCache = [];
    technicianHistoryLastDoc = null;

    const spinner = document.getElementById('technicianHistorySpinner');
    if (spinner) spinner.style.display = 'block';

    const loadMoreBtn = document.getElementById('loadMoreTechnicianHistory');
    if (loadMoreBtn) { loadMoreBtn.style.display = 'none'; loadMoreBtn.disabled = false; loadMoreBtn.innerText = 'Tải thêm'; }

    const filterType = document.getElementById('historyFilterType').value;

    let historyQuery = firebase.firestore().collection('history_transactions').where('email', '==', email);
    if (filterType !== 'Tất cả') {
        historyQuery = historyQuery.where('type', '==', filterType);
    }
    historyQuery = historyQuery.orderBy('timestamp', 'desc').limit(HISTORY_PAGE_SIZE);

    technicianHistoryListener = historyQuery.onSnapshot(snapshot => {
        if (spinner) spinner.style.display = 'none';
        
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = docData.timestamp;
            if (change.type === 'added') {
                if (!technicianHistoryCache.find(item => item.timestamp === docId)) {
                    technicianHistoryCache.push(docData);
                }
            } else if (change.type === 'modified') {
                const index = technicianHistoryCache.findIndex(item => item.timestamp === docId);
                if (index > -1) technicianHistoryCache[index] = docData;
            } else if (change.type === 'removed') {
                technicianHistoryCache = technicianHistoryCache.filter(item => item.timestamp !== docId);
            }
        });

        technicianHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const snapshotSize = snapshot.size;
        technicianHistoryLastDoc = (snapshotSize > 0) ? snapshot.docs[snapshotSize - 1] : null;

        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }
        renderTechnicianHistoryTable();
    }, error => {
        console.error("Lỗi tải lịch sử KTV:", error);
        if (spinner) spinner.style.display = 'none';
        document.getElementById('technicianHistoryBody').innerHTML = '<tr><td colspan="3" class="text-danger">Lỗi tải lịch sử.</td></tr>';
    });
}

function loadMoreTechnicianHistory(email) {
    if (!technicianHistoryLastDoc || !email) return;

    const btn = document.getElementById('loadMoreTechnicianHistory');
    btn.disabled = true; btn.innerText = 'Đang tải...';

    const filterType = document.getElementById('historyFilterType').value;
    let nextQuery = firebase.firestore().collection('history_transactions').where('email', '==', email);
    if (filterType !== 'Tất cả') {
        nextQuery = nextQuery.where('type', '==', filterType);
    }
    nextQuery = nextQuery.orderBy('timestamp', 'desc')
                         .startAfter(technicianHistoryLastDoc)
                         .limit(HISTORY_PAGE_SIZE);

    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            technicianHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => technicianHistoryCache.push(doc.data()));
            renderTechnicianHistoryTable();
        }
        btn.disabled = false; btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) btn.style.display = 'none';
    }).catch(err => {
        console.error("Lỗi tải thêm lịch sử:", err);
        btn.disabled = false; btn.innerText = 'Lỗi! Thử lại';
    });
}
