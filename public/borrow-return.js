// public/borrow-return.js

// === GLOBAL VARIABLES ===
let systemInventory = {};
let cart = {}; // { 'CODE': { name, unit, qty } }
let currentMode = 'borrow'; // 'borrow' | 'return'
let currentSource = 'DIRECT'; // 'DIRECT' | 'PENDING'
let pendingNotesMap = {}; // Cache phiếu chờ
let currentPendingId = null; // ID phiếu đang chọn duyệt
let html5QrCode = null;
let beepAudio = new Audio('chime.mp3');
let technicianData = []; // Cache a list of technician objects

// === INIT ===
document.addEventListener('DOMContentLoaded', async function() {
    auth.onAuthStateChanged(async user => {
        if (!user) { window.location.href = 'index.html'; return; }
        
        const roles = await callApi('/auth/getSelfRoles', {});
        if (!roles.admin && !roles.inventory_manager && !roles.sale) {
            alert("Không có quyền truy cập.");
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('userEmailDisplay').innerText = user.email;
        
        await Promise.all([ 
            loadTechnicians(), 
            loadInventory(),
            loadAllPendingRequests() // Tải thông báo chờ duyệt
        ]);
        
        // Setup initial state for quantity input
        toggleQtyInput();
        
        focusInput();
    });

    // Scanner Listener
    document.getElementById('scanInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') processScan();
    });
    
    // Auto Qty checkbox listener
    document.getElementById('autoQty').addEventListener('change', toggleQtyInput);
});

// Focus Helper
function focusInput() {
    if (!Swal.isVisible()) document.getElementById('scanInput').focus();
}
document.addEventListener('click', (e) => {
    // Đừng chuyển focus nếu click vào các control cần nhập liệu
    if (!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName) && !e.target.closest('.ui-autocomplete')) {
        focusInput();
    }
});

// === 1. DATA LOADING & NOTIFICATIONS ===

async function loadAllPendingRequests() {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    
    try {
        const allPending = await callApi('/manager/all-pending-notes', {}); 
        
        menu.innerHTML = ''; 
        
        if (allPending && allPending.length > 0) {
            badge.innerText = allPending.length;
            badge.style.display = 'block';

            allPending.forEach(note => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'dropdown-item';
                a.href = '#';
                
                const techName = note.name || note.email.split('@')[0];
                const itemQty = note.items ? note.items.length : 0;
                const noteType = note.type === 'Mượn' ? 'mượn' : 'trả';

                // [FIX] Ưu tiên hiển thị note của KTV
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
    } catch (error) {
        console.error("Lỗi tải thông báo chờ:", error);
        badge.style.display = 'none';
        menu.innerHTML = '<li><a class="dropdown-item text-danger" href="#">Lỗi tải thông báo</a></li>';
    }
}

async function handleNotificationClick(email, timestamp, type) {
    // 1. Chuyển chế độ (Mượn/Trả) nếu cần
    const targetMode = type === 'Mượn' ? 'borrow' : 'return';
    if (currentMode !== targetMode) {
        // Chuyển radio và gọi setMode
        document.getElementById(targetMode === 'borrow' ? 'radioBorrow' : 'radioReturn').checked = true;
        setMode(targetMode);
    }

    // 2. Chọn đúng KTV
    const techSelect = document.getElementById('techSelect');
    techSelect.value = email;
    // Manually trigger change event to update avatar
    techSelect.dispatchEvent(new Event('change'));
    
    // 3. Tải phiếu chờ của KTV đó
    await checkPending(email);

    // 4. Chọn đúng phiếu chờ và tải nó
    const pendingSelect = document.getElementById('pendingSelect');
    if (pendingSelect.querySelector(`option[value="${timestamp}"]`)) {
        pendingSelect.value = timestamp;
        toggleOrderSource(); // Chuyển sang chế độ duyệt phiếu
        loadPendingTicket();
    }
}

async function loadTechnicians() {
    const techs = await callApi('/public/technicians');
    technicianData = techs || []; // Cache the full technician objects
    
    const select = document.getElementById('techSelect');
    select.innerHTML = '<option value="">-- Chọn Kỹ Thuật Viên --</option>';
    
    technicianData.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.email;
        opt.text = `${t.name} (${t.email})`;
        select.appendChild(opt);
    });

    // Event change user
    select.addEventListener('change', async function() {
        const email = this.value;
        const avatarImg = document.getElementById('techAvatar');

        if (email) {
            const selectedTech = technicianData.find(t => t.email === email);
            if (selectedTech && avatarImg) {
                avatarImg.src = selectedTech.avatarUrl || '/default-avatar.png';
                avatarImg.style.display = 'inline-block';
            }
            await checkPending(email);
        } else {
            if (avatarImg) {
                avatarImg.style.display = 'none';
            }
            resetPendingUI();
        }
    });
}

async function loadInventory() {
    try {
        const list = await callApi('/inventory/list', {});
        systemInventory = {};
        list.forEach(i => systemInventory[i.code] = { name: i.name, unit: i.unit });
        initItemSearch(); 
    } catch(e) { console.error(e); }
}

function initItemSearch() {
    const source = Object.keys(systemInventory).map(code => {
        const item = systemInventory[code];
        return {
            label: `${item.name} (${code})`,
            value: code,
            name: item.name,
            unit: item.unit
        };
    });

    $("#scanInput").autocomplete({
        source: source,
        minLength: 1, 
        select: function(event, ui) {
            event.preventDefault(); 
            
            const selectedCode = ui.item.value;
            const selectedItem = { name: ui.item.name, unit: ui.item.unit };

            addToCart(selectedCode, selectedItem);
            
            $(this).val('');
        },
        open: function() {
            // Thêm class custom để style riêng cho menu autocomplete
            $(this).autocomplete("widget").addClass("custom-autocomplete-menu");
        }
    });
}

// === 2. PENDING TICKETS LOGIC ===

async function checkPending(email) {
    resetPendingUI();

    // API này chỉ cần trả về phiếu mượn chờ của KTV đã chọn
    const endpoint = currentMode === 'borrow' 
        ? '/manager/pending-borrow-notes' 
        : '/manager/pending-return-notes'; // Giả sử có endpoint cho phiếu trả

    try {
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
                const noteContent = n.items && n.items.length > 0 
                    ? `${n.items.length} món` 
                    : (n.note || 'Trống');
                opt.text = `${d} - ${noteContent}`;
                select.appendChild(opt);
            });
        }
    } catch (e) { 
        console.warn(`Lỗi khi tải phiếu chờ (${currentMode}):`, e); 
    }
}

function resetPendingUI() {
    document.getElementById('pendingOptionDiv').style.display = 'none';
    document.getElementById('pendingSelect').style.display = 'none';
    document.getElementById('pendingSelect').innerHTML = '<option value="">-- Chọn phiếu --</option>';
    document.getElementById('sourceDirect').checked = true;
    currentSource = 'DIRECT';
    currentPendingId = null;
    clearCart();
}

function toggleOrderSource() {
    const val = document.querySelector('input[name="orderSource"]:checked').value;
    currentSource = val;
    const pendingSelect = document.getElementById('pendingSelect');
    const directOption = document.getElementById('directOptionDiv');

    if (val === 'PENDING') {
        pendingSelect.style.display = 'block';
        directOption.classList.remove('shadow-sm'); // Bỏ highlight khỏi mục quét trực tiếp
        // Tự động tải phiếu đầu tiên nếu có
        if (pendingSelect.value) {
            loadPendingTicket(); 
        }
    } else {
        pendingSelect.style.display = 'none';
        directOption.classList.add('shadow-sm'); // Highlight lại mục quét trực tiếp
        clearCart(); 
        currentPendingId = null;
    }
    focusInput();
}

function loadPendingTicket() {
    const id = document.getElementById('pendingSelect').value;
    if (!id) {
        clearCart();
        return;
    }

    const note = pendingNotesMap[id];
    if (!note) return;

    currentPendingId = id;
    cart = {};
    
    (note.items || []).forEach(i => {
        const info = systemInventory[i.code] || { name: i.name, unit: 'Cái' };
        cart[i.code] = {
            name: info.name,
            unit: info.unit,
            qty: parseInt(i.quantity)
        };
    });

    document.getElementById('transactionNote').value = note.note || '';
    renderCart();
    
    Swal.fire({
        toast: true, position: 'top-end', icon: 'info', 
        title: 'Đã tải phiếu chờ', showConfirmButton: false, timer: 1500
    });
}

// === 3. MODE & UI LOGIC ===

function setMode(mode) {
    // Không cần hỏi confirm nữa vì handleNotificationClick sẽ tự chuyển
    // if (Object.keys(cart).length > 0) { ... }

    currentMode = mode;
    const body = document.body;
    const directLabel = document.getElementById('directLabel');
    const title = document.getElementById('listTitle');
    const btn = document.getElementById('btnSubmit');

    if (mode === 'borrow') {
        body.classList.remove('mode-return');
        body.classList.add('mode-borrow');
        directLabel.innerText = "Quét Mượn Trực Tiếp";
        title.innerText = "DANH SÁCH MƯỢN";
        btn.innerText = "XÁC NHẬN MƯỢN";
    } else {
        body.classList.remove('mode-borrow');
        body.classList.add('mode-return');
        directLabel.innerText = "Quét Trả Trực Tiếp";
        title.innerText = "DANH SÁCH TRẢ";
        btn.innerText = "XÁC NHẬN TRẢ";
    }

    const email = document.getElementById('techSelect').value;
    if (email) checkPending(email);
    else resetPendingUI();
}

function toggleQtyInput() {
    const autoQty = document.getElementById('autoQty').checked;
    const qtyGroup = document.getElementById('manualQtyGroup');
    const qtyInput = document.getElementById('manualQtyInput');

    if (autoQty) {
        qtyGroup.style.display = 'none';
    } else {
        qtyGroup.style.display = 'flex';
        qtyInput.focus();
        qtyInput.select();
    }
}

// === 4. SCANNING LOGIC ===

function processScan() {
    const input = document.getElementById('scanInput');
    const rawCode = input.value.trim();
    if (!rawCode) return;

    const item = systemInventory[rawCode];
    if (item) {
        addToCart(rawCode, item);
        beepAudio.currentTime = 0; 
        beepAudio.play().catch(()=>{});
        
        Swal.mixin({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 800
        }).fire({ icon: 'success', title: item.name });
    } else {
        Swal.fire('Lỗi', `Mã "${rawCode}" không tồn tại`, 'error');
    }
    input.value = '';
    focusInput();
}

function addToCart(code, item) {
    const autoQty = document.getElementById('autoQty').checked;
    const qtyInput = document.getElementById('manualQtyInput');
    
    if (!cart[code]) cart[code] = { ...item, qty: 0 };

    let quantityToAdd = 1;
    if (!autoQty) {
        quantityToAdd = parseInt(qtyInput.value) || 1;
    }

    cart[code].qty += quantityToAdd;
    
    // Reset Qty input to 1 for next time and re-render
    qtyInput.value = '1';
    renderCart();
    
    // Return focus to main scan input
    if(!autoQty) {
        focusInput();
    }
}

function renderCart() {
    const tbody = document.getElementById('cartBody');
    tbody.innerHTML = '';
    let total = 0;
    let idx = 1;

    Object.keys(cart).reverse().forEach(code => {
        const it = cart[code];
        total += it.qty;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx++}</td>
            <td class="fw-bold text-primary">${code}</td>
            <td>${it.name}</td>
            <td class="text-center">
                <div class="input-group input-group-sm justify-content-center" style="width:120px;">
                    <button class="btn btn-outline-secondary" onclick="updateItem('${code}', -1)">-</button>
                    <input class="form-control text-center fw-bold" value="${it.qty}" readonly>
                    <button class="btn btn-outline-secondary" onclick="updateItem('${code}', 1)">+</button>
                </div>
            </td>
            <td><button class="btn btn-sm text-danger" onclick="delItem('${code}')"><i class="fas fa-times"></i></button></td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('totalQtyBadge').innerText = `${total} món`;
    
    if (total === 0) tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted">Vui lòng chọn KTV và quét mã...</td></tr>';
}

function updateItem(code, delta) {
    if (cart[code]) {
        cart[code].qty += delta;
        if (cart[code].qty <= 0) delete cart[code];
        renderCart();
    }
}
function delItem(code) {
    delete cart[code];
    renderCart();
}
function clearCart() {
    cart = {};
    renderCart();
    focusInput();
}

// === 5. SUBMIT ===

async function submitTransaction() {
    const email = document.getElementById('techSelect').value;
    const note = document.getElementById('transactionNote').value;

    if (!email) return Swal.fire('Thiếu thông tin', 'Chưa chọn Kỹ thuật viên', 'warning');
    if (Object.keys(cart).length === 0) return Swal.fire('Trống', 'Chưa quét vật tư nào', 'warning');

    // 1. Chuẩn bị payload
    const items = Object.keys(cart).map(c => ({
        code: c, name: cart[c].name, quantity: cart[c].qty,
        quantityReturned: currentMode === 'return' ? cart[c].qty : undefined
    }));

    // 2. Xác định mode backend và các thông tin khác
    let modeAPI = '';
    if (currentSource === 'PENDING' && currentPendingId) {
        // Áp dụng cho cả duyệt mượn và duyệt trả
        modeAPI = 'NOTE'; 
    } else {
        // Áp dụng cho cả mượn trực tiếp và trả trực tiếp
        modeAPI = currentMode === 'borrow' ? 'DIRECT' : 'MANAGER_DIRECT';
    }

    const payload = {
        email: email,
        type: currentMode === 'borrow' ? 'Mượn' : 'Trả',
        mode: modeAPI,
        date: new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}),
        timestamp: new Date().toISOString(),
        items: items,
        note: note,
        // Gửi ID phiếu chờ vào đúng trường dựa trên mode
        borrowTimestamp: (currentMode === 'borrow' && currentSource === 'PENDING') ? currentPendingId : undefined,
        returnTimestamp: (currentMode === 'return' && currentSource === 'PENDING') ? currentPendingId : undefined
    };

    const actionName = currentMode === 'borrow' ? 'XUẤT MƯỢN' : 'NHẬP TRẢ';
    const result = await Swal.fire({
        title: `Xác nhận ${actionName}`,
        html: `Cho KTV: <b>${email}</b><br>Số lượng: <b>${document.getElementById('totalQtyBadge').innerText}</b>`,
        icon: 'question', showCancelButton: true, confirmButtonText: 'Đồng ý'
    });

    if (result.isConfirmed) {
        Swal.showLoading();
        try {
            // 3. [FIX] Chọn đúng API endpoint dựa trên mode
            const apiEndpoint = currentMode === 'borrow' 
                ? '/manager/submitBorrow' 
                : '/manager/submitReturn';

            console.log(`Calling API: ${apiEndpoint} with payload:`, payload);
            await callApi(apiEndpoint, payload);
            
            await Swal.fire('Thành công', 'Giao dịch đã được lưu', 'success');
            
            clearCart();
            document.getElementById('transactionNote').value = '';
            
            // Tải lại cả thông báo chung và phiếu chờ của KTV hiện tại
            await Promise.all([
                loadAllPendingRequests(),
                checkPending(email) 
            ]);

        } catch (e) {
            Swal.fire('Lỗi', e.message, 'error');
        }
    }
}

// === 6. CAMERA ===
function toggleCamera() {
    const box = document.getElementById('cameraSection');
    if (box.style.display === 'none') {
        box.style.display = 'block';
        if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, 
            (txt) => {
                document.getElementById('scanInput').value = txt;
                processScan();
            }, 
            () => {}
        );
    } else {
        box.style.display = 'none';
        if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear());
    }
}