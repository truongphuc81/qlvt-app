// public/app.js (FILE MỚI - CHỈ CÓ LOGIC KTV)

// === BIẾN TOÀN CỤC (CHO KTV) ===
let userEmail = '';
let technicianName = '';
let userRoles = {};
let ktvHistoryListener = null;
let ktvHistoryCache = [];
let ktvHistoryLastDoc = null;
var selectedTickets = [];
let allReconciledTicketsCache = [];
let reconciledTicketsCurrentPage = 1;
const HISTORY_PAGE_SIZE = 15;

// === KHỞI TẠO VÀ AUTH ===

/**
 * Khởi tạo Datepickers (KTV không dùng), Dark Mode, Table View
 */
function initForm() {
    console.log("Hàm initForm() (KTV) đang chạy...");
    try {
        // KTV không có datepicker
    } catch(e) {}

    // try {
    //     if (localStorage.getItem('darkMode') === 'true') {
    //         document.body.classList.add('dark-mode');
    //     }
    // } catch(e) {}
    
    // try {
    //      if (localStorage.getItem('tableView') === 'card') {
    //         document.body.classList.add('card-view-mobile');
    //      }
    // } catch(e) {}
}

/**
 * Đăng nhập
 */
function signInWithGoogle() {
    auth.signInWithPopup(provider).catch((error) => {
        console.error("Lỗi signInWithPopup:", error.message);
        if (error.code !== 'auth/popup-closed-by-user') {
            showError('infoErrorMessage', 'Lỗi đăng nhập: ' + error.message);
        }
    });
}

/**
 * Lắng nghe thay đổi Auth
 */
function attachAuthListener(authButton) {
    auth.onAuthStateChanged(user => {
        if (user) {
            console.log("Auth State: Đã tìm thấy user.");
            handleAuthSuccess(user);
        } else {
            console.log("Auth State: Không tìm thấy user.");
            document.getElementById('mainPage').style.display = 'none';
            if (authButton) {
                authButton.textContent = 'Đăng nhập bằng Gmail';
                authButton.style.display = 'inline-block';
                authButton.onclick = signInWithGoogle;
            }
            document.getElementById('userEmail').innerText = 'Chưa đăng nhập';
            document.getElementById('technicianName').innerText = 'Chưa đăng nhập';
            if (ktvHistoryListener) {
                ktvHistoryListener();
                ktvHistoryListener = null;
            }
            const infoSpinner = document.getElementById('infoSpinner');
            if(infoSpinner) infoSpinner.style.display = 'none';
        }
    });
}

/**
 * Xử lý khi Auth thành công (Cho KTV)
 */
async function handleAuthSuccess(user) {
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    const infoSpinner = document.getElementById('infoSpinner');
    const mainPage = document.getElementById('mainPage');

    if (authButton) authButton.style.display = 'none';
    if (signOutButton) signOutButton.style.display = 'inline-block';
    if (infoSpinner) infoSpinner.style.display = 'block'; 
    if (mainPage) mainPage.style.display = 'none';

    userEmail = user.email;
    technicianName = user.displayName;

    try {
        // Vẫn gọi getSelfRoles để biết có phải Manager không
        const roles = await callApi('/auth/getSelfRoles', {}); 
        userRoles = roles;
        const isManager = userRoles.admin || userRoles.inventory_manager;
        console.log(`Roles: isManager=${isManager}, isAdmin=${userRoles.admin}`);
        
        if (infoSpinner) infoSpinner.style.display = 'none'; 

        // Luôn hiển thị trang KTV
        console.log("Hiển thị trang KTV.");
        if (mainPage) mainPage.style.display = 'block';
        document.getElementById('userEmail').innerText = userEmail;
        document.getElementById('technicianName').innerText = technicianName;
        loadSelfDashboard();
        listenForKtvHistory(); // Bật listener cho KTV

        // Hiển thị nút Quản lý (nếu có quyền)
        if (isManager) {
            console.log("User là Manager/Admin. Hiển thị nút 'Trang Quản Lý'.");
            const managerWrapper = document.getElementById('managerPageButtonWrapper');
            if (managerWrapper) managerWrapper.style.display = 'block'; // Hiển thị wrapper
            // Fallback cho code cũ nếu không tìm thấy wrapper
            const managerBtn = document.getElementById('managerPageButton');
            if (managerBtn) managerBtn.style.display = 'inline-block';
        }
    
    } catch (err) {
        if (infoSpinner) infoSpinner.style.display = 'none'; 
        console.error("Lỗi kiểm tra vai trò (claims):", err);
        showError('infoErrorMessage', 'Lỗi kiểm tra vai trò: ' + err.message);
        
        // Vẫn hiển thị trang KTV cơ bản nếu có lỗi
        if (mainPage) mainPage.style.display = 'block';
        document.getElementById('userEmail').innerText = userEmail;
        document.getElementById('technicianName').innerText = technicianName;
        loadSelfDashboard();
        listenForKtvHistory();
    }
}

// === TẤT CẢ CÁC HÀM CỦA KTV (COPY TỪ APP.JS) ===

function loadSelfDashboard(){
    const overviewSpinner = document.getElementById('overviewSpinner');
    const returnSpinner = document.getElementById('returnSpinner');
    
    if (overviewSpinner) overviewSpinner.style.display='block';
    if (returnSpinner) returnSpinner.style.display='block';
    
    const infoError = document.getElementById('infoErrorMessage');
    if(infoError) infoError.style.display = 'none'; 

    callApi('/dashboard', { technicianEmail: userEmail })
        .then(payload => {
            // (false = không phải giao diện quản lý)
            displayBorrowedItems(payload.items || [], false); 
        })
        .catch(err => {
            showError('overviewErrorMessage', 'Lỗi tải tổng quan: ' + err.message);
            showError('returnErrorMessage', 'Lỗi tải tổng quan: ' + err.message);
        })
        .finally(() => {
            if (overviewSpinner) overviewSpinner.style.display='none';
            if (returnSpinner) returnSpinner.style.display='none';
        });
}

// public/app.js (SỬA LẠI HÀM NÀY)

function displayBorrowedItems(items) { // <-- 1. ĐÃ XÓA 'isManagerView'
    var overviewBody = document.getElementById('overviewBody');
    var returnBody   = document.getElementById('borrowedItemsBody');
    var reconciledBody = document.getElementById('reconciledTicketsBody');

    overviewBody.innerHTML='';
    returnBody.innerHTML='';
    if (reconciledBody) reconciledBody.innerHTML = ''; 

    // === 2. DÁN 3 DÒNG SAU VÀO ĐÂY ===
    // Ẩn nút "Tải thêm" của bảng CHƯA đối chiếu (vì nó không hỗ trợ)
    const loadMoreUnreconciledBtn = document.getElementById('loadMoreUnreconciled');
    if (loadMoreUnreconciledBtn) loadMoreUnreconciledBtn.style.display = 'none';
    // === KẾT THÚC DÁN ===

    let itemsShownInOverview = 0; 
    const tickets = {}; 
    const reconciledTickets = {}; 

    items.forEach(function(item){
      var remaining = item.remaining || 0; 
      if (remaining > 0 || (item.unreconciledUsageDetails && item.unreconciledUsageDetails.length > 0)) {
          itemsShownInOverview++;
          var row=document.createElement('tr');
          row.innerHTML = '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                        '<td data-label="Tổng mượn">'+item.quantity+'</td>'+
                        '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                        '<td data-label="Đã trả">'+item.totalReturned+'</td>'+
                        '<td data-label="Còn lại">'+remaining+'</td>';
          overviewBody.appendChild(row);
      }

      (item.unreconciledUsageDetails || []).forEach(function(detail) {
          if (!tickets[detail.ticket]) {
              tickets[detail.ticket] = {
                  ticket: detail.ticket,
                  ticketNumber: parseInt((detail.ticket || 'Sổ 0').match(/\d+$/)[0], 10) || 0,
                  items: [] 
              };
          }
          tickets[detail.ticket].items.push({ name: item.name, code: item.code, quantity: detail.quantity });
      });

      (item.reconciledUsageDetails || []).forEach(function(detail) { 
          let ticketKey = detail.ticket || `unknown-${item.code}`;
          let existingTicket = reconciledTickets[ticketKey];
          if (!existingTicket) {
               existingTicket = {
                    ticket: ticketKey,
                    ticketNumber: parseInt((ticketKey || 'Sổ 0').match(/\d+$/)[0], 10) || 0,
                    items: [] 
                };
                reconciledTickets[ticketKey] = existingTicket;
          }
          existingTicket.items.push({ name: item.name, code: item.code, quantity: detail.quantity });
      });
    });

    if (itemsShownInOverview === 0) {
        overviewBody.innerHTML = `<tr><td colspan="5">Không có vật tư nào đang nợ.</td></tr>`;
    }

    const sortedTickets = Object.values(tickets).sort((a, b) => a.ticketNumber - b.ticketNumber);
    sortedTickets.forEach(function(ticket) {
        var rr = document.createElement('tr');
        var combinedHtml = ticket.items.map(function(it) {
            var name = (it.name || 'N/A');
            var qty = it.quantity;
            return name + ': <span class="item-quantity-in-card">' + qty + '</span>';
        }).join('<br>'); 
        rr.innerHTML =
            '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
            '<td data-label="Vật tư & SL">' + combinedHtml + '</td>' + 
            '<td data-label="Xác nhận"><input type="checkbox" class="ticket-checkbox" value="' + ticket.ticket + '"></td>'; 
        returnBody.appendChild(rr);
    });
    if (sortedTickets.length === 0) {
         returnBody.innerHTML='<tr><td colspan="3">Chưa có sổ cần đối chiếu</td></tr>';
    }

    const sortedReconciled = Object.values(reconciledTickets).sort((a, b) => b.ticketNumber - a.ticketNumber); 
    allReconciledTicketsCache = sortedReconciled; 
    reconciledTicketsCurrentPage = 1;
    renderReconciledTicketsTable();
}

function submitBorrowForm(){
    const button = document.getElementById('submitBorrowButton');
    button.disabled = true; // Disable button immediately

    var note = (document.getElementById('borrowItems').value || '').trim();
    if (!note) { 
        showError('borrowErrorMessage', 'Vui lòng nhập nội dung mượn.');
        button.disabled = false; // Re-enable on validation failure
        return; 
    }
    
    var data = {
      timestamp: new Date().toISOString(),
      type: 'Mượn', 
      email: userEmail, 
      date: new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}),
      note: note, 
      items: []
    };

    document.getElementById('borrowSpinner').style.display = 'block';
    
    callApi('/submit/borrow', data)
        .then(() => {
            showSuccess('borrowSuccessMessage', 'Gửi yêu cầu mượn thành công!');
            document.getElementById('borrowItems').value = '';
            loadSelfDashboard();
        })
        .catch(err => { 
            showError('borrowErrorMessage', 'Lỗi gửi yêu cầu: ' + err.message); 
        })
        .finally(() => { 
            document.getElementById('borrowSpinner').style.display = 'none';
            button.disabled = false; // Re-enable after API call finishes
        });
}

function submitReturnForm(){
    selectedTickets=[];
    var checkboxes = document.querySelectorAll('#borrowedItemsTable .ticket-checkbox:checked');
    if (checkboxes.length === 0) {
        showError('returnErrorMessage','Vui lòng chọn ít nhất một số sổ để xác nhận.');
        return;
    }
    checkboxes.forEach(function(cb){ selectedTickets.push(cb.value); });
    var data={
      timestamp: new Date().toISOString(), type:'Trả', email:userEmail,
      date: new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
      tickets: selectedTickets, items: []
    };
    document.getElementById('returnSpinner').style.display='block';
    callApi('/submit/return', data)
        .then(() => {
            showSuccess('returnSuccessMessage','Xác nhận đối chiếu thành công!');
            selectedTickets=[]; 
            loadSelfDashboard();
        })
        .catch(err => { showError('returnErrorMessage','Lỗi xác nhận: '+err.message); })
        .finally(() => { document.getElementById('returnSpinner').style.display='none'; });
}

function submitErrorReport(){
    var data={
      email:userEmail,
      errorType:document.getElementById('errorType').value,
      description:(document.getElementById('errorDescription').value||'').trim(),
      relatedTicketOrDate:(document.getElementById('relatedTicketOrDate').value||'').trim(),
      suggestedFix:(document.getElementById('suggestedFix').value||'').trim()
    };
    if (!data.description){ showError('errorReportErrorMessage','Vui lòng nhập mô tả sai sót.'); return; }
    document.getElementById('errorReportSpinner').style.display='block';
    callApi('/submit/errorReport', data)
        .then(() => {
            showSuccess('errorReportSuccessMessage','Gửi báo cáo thành công!');
            hideErrorReportForm();
        })
        .catch(err => { showError('errorReportErrorMessage','Lỗi gửi báo cáo: '+err.message); })
        .finally(() => { document.getElementById('errorReportSpinner').style.display='none'; });
}

function showErrorReportForm(){ document.getElementById('errorReportForm').style.display='block'; }
function hideErrorReportForm(){ document.getElementById('errorReportForm').style.display='none'; }

function loadKtvReturnItems() {
    const tbody = document.getElementById('ktvReturnItemsBody');
    if (!tbody) return;
    const spinner = document.getElementById('ktvReturnSpinner');
    if (spinner) spinner.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="3"><div class="spinner"></div> Đang tải...</td></tr>';
    callApi('/dashboard', { technicianEmail: userEmail })
        .then(payload => {
            const items = payload.items || [];
            const returnableItems = items.filter(it => it.remaining > 0);
            tbody.innerHTML = '';
            const submitBtn = document.getElementById('submitKtvReturnButton');
            if (returnableItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3">Bạn không nợ vật tư nào để trả.</td></tr>';
                if (submitBtn) submitBtn.style.display = 'none';
                return;
            }
            if (submitBtn) submitBtn.style.display = 'inline-block';
            returnableItems.forEach(item => {
                var tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Tên vật tư">${item.name}</td>
                    <td data-label="Đang nợ" style="text-align: center;">${item.remaining}</td>
                    <td data-label="Số lượng trả">
                        <input type="number" class="ktv-return-input"
                               min="0" max="${item.remaining}" value="0"
                               data-code="${item.code}" data-name="${item.name}"
                               style="width: 80px; max-width: 100px; padding: 8px; text-align: center;">
                    </td>`;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            showError('ktvReturnErrorMessage', 'Lỗi tải danh sách vật tư nợ: ' + err.message);
            tbody.innerHTML = '<tr><td colspan="3">Lỗi tải danh sách.</td></tr>';
        })
        .finally(() => {
            if (spinner) spinner.style.display = 'none';
        });
}

function submitKtvReturnItems() {
    const spinner = document.getElementById('ktvReturnSpinner');
    const inputs = document.querySelectorAll('#ktvReturnItemsTable .ktv-return-input');
    const itemsToReturn = [];
    let hasError = false;
    showError('ktvReturnErrorMessage', '');
    showSuccess('ktvReturnSuccessMessage', '');
    inputs.forEach(input => {
        if(hasError) return;
        const qty = parseInt(input.value, 10) || 0;
        const max = parseInt(input.max, 10);
        const code = input.dataset.code;
        const name = input.dataset.name;
        if (qty < 0 || qty > max) {
            showError('ktvReturnErrorMessage', `Số lượng trả cho ${name || code} không hợp lệ (0 đến ${max}).`);
            input.focus();
            hasError = true;
            return;
        }
        if (qty > 0) {
            itemsToReturn.push({ code: code, name: name, quantityReturned: qty });
        }
    });
    if (hasError) return;
    if (itemsToReturn.length === 0) {
        showError('ktvReturnErrorMessage', 'Vui lòng nhập số lượng cho ít nhất 1 vật tư để trả.');
        return;
    }
    const note = (document.getElementById('ktvReturnNote').value || '').trim();
    const data = {
        timestamp: new Date().toISOString(), type: 'Trả', email: userEmail,
        date: new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}),
        note: note || 'KTV trả vật tư không sử dụng',
        items: itemsToReturn
    };
    if (spinner) spinner.style.display = 'block';
    callApi('/submit/return', data)
        .then(() => {
            showSuccess('ktvReturnSuccessMessage', 'Gửi yêu cầu trả thành công! Chờ quản lý duyệt.');
            document.getElementById('ktvReturnNote').value = '';
            loadKtvReturnItems();
            loadSelfDashboard();
        })
        .catch(err => { showError('ktvReturnErrorMessage', 'Lỗi gửi yêu cầu trả: ' + err.message); })
        .finally(() => { if (spinner) spinner.style.display = 'none'; });
}

function formatKtvHistoryContent(doc) {
    let html = '';
    let statusHtml = '';
    if (doc.status === 'Pending') {
        statusHtml = `<span style="color: blue; font-style: italic;">(Đang chờ duyệt...)</span><br>`;
    } else if (doc.status === 'Rejected') {
        let reason = doc.rejectionReason ? `: ${doc.rejectionReason}` : '';
        statusHtml = `<span style="color: red; font-style: italic;">(Bị từ chối${reason})</span><br>`;
    }
    let noteDisplay = (doc.status === 'Rejected' && doc.note) ? `<s>${doc.note}</s>` : doc.note;
    if (noteDisplay) html += `<strong>Nội dung:</strong> ${noteDisplay}<br>`;
    html += statusHtml;
    if (doc.items && doc.items.length > 0) {
        html += `<strong>Vật tư đã duyệt:</strong><ul>`;
        doc.items.forEach(item => { html += `<li>${item.name || item.code}: ${item.quantity}</li>`; });
        html += `</ul>`;
    }
    if (!html.trim()) html = '...';
    return html;
}

function renderKtvHistoryTable() {
    const tbody = document.getElementById('ktvHistoryBody');
    if (!tbody) return; 
    const filterValue = document.getElementById('ktvHistoryFilterType').value;
    tbody.innerHTML = '';
    const filteredDocs = ktvHistoryCache.filter(doc => {
        const typeMatch = (filterValue === 'Tất cả' || doc.type === filterValue);
        const isHiddenNote = doc.note === 'Điều chỉnh kho âm (Tự động)';
        return typeMatch && !isHiddenNote;
    });
    if (filteredDocs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Không có dữ liệu.</td></tr>';
        return;
    }
    filteredDocs.forEach(doc => {
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'unreconciled' : 'success'; 
        tr.innerHTML = `
            <td data-label="Thời gian">${timestamp}</td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatKtvHistoryContent(doc)}</td>`;
        tbody.appendChild(tr);
    });
}

function listenForKtvHistory() {
    if (ktvHistoryListener) ktvHistoryListener();
    const spinner = document.getElementById('ktvHistorySpinner');
    spinner.style.display = 'block';
    const loadMoreBtn = document.getElementById('loadMoreKtvHistory');
    if (loadMoreBtn) { loadMoreBtn.style.display = 'none'; loadMoreBtn.disabled = false; loadMoreBtn.innerText = 'Tải thêm'; }
    const historyQuery = db.collection('history_transactions')
                                    .where('email', '==', userEmail)
                                    .orderBy('timestamp', 'desc')
                                    .limit(HISTORY_PAGE_SIZE); 
    ktvHistoryListener = historyQuery.onSnapshot(snapshot => {
        spinner.style.display = 'none';
        ktvHistoryCache = [];
        snapshot.forEach(doc => ktvHistoryCache.push(doc.data()));
        ktvHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const snapshotSize = snapshot.size;
        ktvHistoryLastDoc = snapshotSize > 0 ? snapshot.docs[snapshotSize - 1] : null;
        if (loadMoreBtn) loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        renderKtvHistoryTable();
    }, error => {
        console.error("Lỗi KTV Real-time History:", error);
        spinner.style.display = 'none';
        document.getElementById('ktvHistoryBody').innerHTML = '<tr><td colspan="3" class="error">Lỗi tải lịch sử.</td></tr>';
        if (ktvHistoryListener) { ktvHistoryListener(); ktvHistoryListener = null; }
    });
    console.log("Đã bật listener lịch sử (KTV) cho Trang 1.");
}

function loadMoreKtvHistory() {
    if (!ktvHistoryLastDoc) return;
    const btn = document.getElementById('loadMoreKtvHistory');
    btn.disabled = true; btn.innerText = 'Đang tải...';
    const nextQuery = db.collection('history_transactions')
                                .where('email', '==', userEmail)
                                .orderBy('timestamp', 'desc')
                                .startAfter(ktvHistoryLastDoc)
                                .limit(HISTORY_PAGE_SIZE);
    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            ktvHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => ktvHistoryCache.push(doc.data()));
            renderKtvHistoryTable();
        }
        btn.disabled = false; btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) btn.style.display = 'none';
    }).catch(err => {
        console.error("Lỗi tải thêm (KTV):", err);
        btn.disabled = false; btn.innerText = 'Lỗi! Thử lại';
    });
}

function renderReconciledTicketsTable() {
    const tbody = document.getElementById('reconciledTicketsBody');
    const loadMoreBtn = document.getElementById('loadMoreReconciled');
    if (!tbody) return; 
    tbody.innerHTML = ''; 
    const itemsToShow = allReconciledTicketsCache.slice(0, reconciledTicketsCurrentPage * HISTORY_PAGE_SIZE);
    if (itemsToShow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2">Chưa có sổ đã đối chiếu</td></tr>'; 
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        return;
    }
    itemsToShow.forEach(function(ticket) {
        var rRow = document.createElement('tr');
        var combinedHtml = ticket.items.map(function(it) {
            var name = (it.name || 'N/A');
            var qty = it.quantity;
            return name + ': <span class="item-quantity-in-card">' + qty + '</span>';
        }).join('<br>');
        rRow.innerHTML =
            '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
            '<td data-label="Vật tư & SL">' + combinedHtml + '</td>';
        tbody.appendChild(rRow);
    });
    if (loadMoreBtn) {
        if (itemsToShow.length < allReconciledTicketsCache.length) {
            loadMoreBtn.style.display = 'block';
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerText = 'Tải thêm';
        } else {
            loadMoreBtn.style.display = 'none'; 
        }
    }
}

function loadMoreReconciledTickets() {
    const btn = document.getElementById('loadMoreReconciled');
    btn.disabled = true;
    btn.innerText = 'Đang tải...';
    reconciledTicketsCurrentPage++;
    renderReconciledTicketsTable();
}


// === KHỞI ĐỘNG (Cho trang KTV) ===
document.addEventListener('DOMContentLoaded', function(){ 
    const authButton = document.getElementById('authButton');
    attachAuthListener(authButton); 
    initForm();
    
    // Kích hoạt Toggle Headers (copy từ app.js)
    jQuery(document).ready(function($) {
        $('.toggle-header').on('click', function() {
            var header = $(this);
            var content = header.next('.toggle-content');
            var contentId = content.attr('id');

            if (contentId === 'returnContent' && !header.hasClass('active')) {
                 loadKtvReturnItems();
            }
            content.slideToggle(300);
            header.toggleClass('active');
        });
    });
});