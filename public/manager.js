// public/manager.js (FILE MỚI)

// === BIẾN TOÀN CỤC (CHO TRANG QUẢN LÝ) ===
let userEmail = '';
let technicianName = '';
let userRoles = {};
let processedExcelData = [];
let techniciansLoaded = false;
let technicianMap = new Map();
let managerHistoryListener = null;
let managerHistoryCache = [];
let itemListCache = [];
let html5QrCodeScanner = null;
let isQrScannerRunning = false;
let managerHistoryLastDoc = null;
let currentNegativeItems = [];
var managerSelectedItems = [];
var borrowNotes = [];
var ticketRanges = [];
var excelData = [];
var pendingReturnNotes = [];
var managerReturnItems = [];
const HISTORY_PAGE_SIZE = 15;

// === KHỞI TẠO VÀ AUTH ===

/**
 * Khởi tạo Datepickers, Dark Mode
 */
function initForm() {
    console.log("Hàm initForm() (Manager) đang chạy...");
    try {
        // Chỉ khởi tạo datepicker cho trang Quản lý
        jQuery("#managerTransactionDate").datepicker({ dateFormat: 'dd/mm/yy' });
        jQuery("#transferDate").datepicker({ dateFormat: 'dd/mm/yy' });
        jQuery("#approveReturnDate").datepicker({ dateFormat: 'dd/mm/yy' });
        jQuery("#directReturnDate").datepicker({ dateFormat: 'dd/mm/yy' });

        const today = new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});
        
        // Điền cho ô Trả hàng
        const returnDateInput = document.getElementById('directReturnDate');
        if(returnDateInput) returnDateInput.value = today;

        // Điền cho ô Duyệt note (ẩn)
        const approveDateInput = document.getElementById('approveReturnDate');
        if(approveDateInput) approveDateInput.value = today;
    } catch (e) {
        console.warn("Lỗi khởi tạo jQuery Datepicker:", e.message);
    }
    // try {
    //     if (localStorage.getItem('darkMode') === 'true') {
    //         document.body.classList.add('dark-mode');
    //     }
    // } catch (e) {}
}

/**
 * Đăng nhập
 */
function signInWithGoogle() {
    auth.signInWithPopup(provider).catch((error) => {
        console.error("Lỗi signInWithPopup:", error.message);
    });
}

/**
 * Lắng nghe thay đổi Auth
 */
function attachAuthListener(authButton, signOutButton) {
    auth.onAuthStateChanged(user => {
        if (user) {
            // User đã đăng nhập
            userEmail = user.email;
            technicianName = user.displayName;
            if (authButton) authButton.style.display = 'none';
            if (signOutButton) signOutButton.style.display = 'inline-block';
            
            // Gọi hàm xử lý thành công (của Manager)
            handleManagerAuthSuccess(user);

        } else {
            // User chưa đăng nhập
            if (authButton) authButton.style.display = 'inline-block';
            if (signOutButton) signOutButton.style.display = 'none';
            document.getElementById('managerPage').style.display = 'none';
            
            // Hủy listener
            if (managerHistoryListener) managerHistoryListener();
        }
    });
}

/**
 * Xử lý khi Auth thành công (Cho Manager)
 */
async function handleManagerAuthSuccess(user) {
    try {
        const roles = await callApi('/auth/getSelfRoles', {});
        userRoles = roles;
        
        // Kiểm tra xem có phải Manager/Admin không
        const isManager = userRoles.admin || userRoles.inventory_manager;

        if (isManager) {
            // OK, hiển thị trang
            console.log("Xác thực Manager thành công. Hiển thị trang.");
            document.getElementById('managerPage').style.display = 'block';
            
            // Tải các tài nguyên cần thiết
            loadTechnicians();
            initItemSearch();
            showManagerPage(); // (Hàm này sẽ ẩn/hiện mục theo quyền Admin/Inv Mgr)
            listenForManagerHistory();
            loadPendingNotifications();
            
        } else {
            // Không phải Manager, báo lỗi và điều hướng
            console.warn("User không phải Manager. Đang điều hướng...");
            alert("Bạn không có quyền truy cập trang này. Đang quay lại trang chính.");
            window.location.href = 'index.html';
        }
    
    } catch (err) {
        console.error("Lỗi kiểm tra vai trò (claims):", err);
        alert('Lỗi kiểm tra vai trò: ' + err.message + '. Vui lòng thử lại.');
        firebase.auth().signOut();
    }
}

// === TẤT CẢ CÁC HÀM CỦA QUẢN LÝ (COPY TỪ APP.JS) ===

function showManagerPage(){
    // 1. Lấy các mục chỉ dành cho Admin (để ẩn/hiện)
    const excelForm = document.getElementById('excelUploadForm');
    const transferForm = document.getElementById('transferForm');
    const ticketRangeForm = document.getElementById('ticketRangeForm');
    const roleManagerForm = document.getElementById('roleManagerForm');
    const globalOverviewSection = document.getElementById('globalOverviewSection');

    // 2. Lấy các element giao diện Tab và Layout mới
    const tabReturn = document.getElementById('tab-return');
    const tabBorrow = document.getElementById('tab-borrow');
    const layoutContainer = document.querySelector('.borrow-layout');

    // === QUAN TRỌNG: LUÔN RESET GIAO DIỆN VỀ MẶC ĐỊNH (2 CỘT) ===
    // Xóa class 1 cột (nếu có) để đảm bảo Cột Trái (Cấu hình) luôn hiện
    if (layoutContainer) layoutContainer.classList.remove('single-column');
    
    // Luôn hiện Tab Trả (theo yêu cầu mới)
    if (tabReturn) tabReturn.style.display = ''; 
    if (tabBorrow) tabBorrow.style.width = ''; 
    // =============================================================

    if (userRoles.admin) {
        console.log("Admin view: Hiển thị tất cả.");
        
        if (excelForm) excelForm.style.display = '';
        if (transferForm) transferForm.style.display = '';
        if (ticketRangeForm) ticketRangeForm.style.display = '';
        if (roleManagerForm) roleManagerForm.style.display = '';
        if (globalOverviewSection) globalOverviewSection.style.display = '';

    } else {
        console.log("Inventory Manager view: Ẩn các mục Admin, giữ nguyên giao diện Mượn/Trả.");
        
        // Chỉ ẩn các Form chức năng nâng cao
        if (excelForm) excelForm.style.display = 'none';
        if (transferForm) transferForm.style.display = 'none';
        if (ticketRangeForm) ticketRangeForm.style.display = 'none';
        if (roleManagerForm) roleManagerForm.style.display = 'none';
        if (globalOverviewSection) globalOverviewSection.style.display = 'none';

        // Mặc định chọn tab Mượn khi mới vào
        selectMode('borrow'); 
    }
    
    loadPendingNotifications(); 
    listenForManagerHistory();
}

function loadTechnicians(){
    // (Copy toàn bộ nội dung hàm loadTechnicians từ app.js)
    // Hàm này gọi /manager/technicians (đã được bảo vệ)
    techniciansLoaded = false;
    technicianMap.clear();
    const techSpinner = document.getElementById('technicianSpinner');
    if (techSpinner) techSpinner.style.display='block';

    callApi('/manager/technicians') // <-- Dùng API được bảo vệ
        .then(techs => {
            var selManager = document.getElementById('technicianEmail');
            var selFrom = document.getElementById('transferFromTech');
            var selTo = document.getElementById('transferToTech');
            var selManagerHistory = document.getElementById('managerHistoryFilterTech');
            // (Không cần selAuditorHistory)

            if (selManager) selManager.innerHTML='<option value="">Chọn kỹ thuật viên</option>';
            if (selFrom) selFrom.innerHTML = '<option value="">-- Chọn người chuyển --</option>';
            if (selTo) selTo.innerHTML = '<option value="">-- Chọn người nhận --</option>';
            if (selManagerHistory) selManagerHistory.innerHTML = '<option value="Tất cả">Tất cả KTV</option>';

            (techs||[]).forEach(function(t, index){
                if (!t || !t.email) return;
                const name = t.name || t.email;
                const text = t.name ? `${t.name} (${t.email})` : t.email;
                technicianMap.set(t.email, name);

                var o=document.createElement('option');
                o.value=t.email;
                o.text= text;

                if (selManager) selManager.appendChild(o.cloneNode(true));
                if (selFrom) selFrom.appendChild(o.cloneNode(true));
                if (selTo) selTo.appendChild(o.cloneNode(true));
                if (selManagerHistory) selManagerHistory.appendChild(o.cloneNode(true));
            });
            techniciansLoaded = true;
        })
        .catch(err => {
            showError('technicianErrorMessage','Lỗi tải danh sách KTV: '+err.message);
            techniciansLoaded = false;
        })
        .finally(() => {
            if (techSpinner) techSpinner.style.display='none';
        });
}

function initItemSearch(){
    callApi('/manager/items')
      .then(items => {
        itemListCache = items || []; 
        console.log(`Đã cache ${itemListCache.length} vật tư.`);
        var src = (itemListCache).map(function(it){ 
            return { label: it.code + ' - ' + it.name, value: it.code, name: it.name }; 
        });
        jQuery('#managerItemSearch').autocomplete({
          source: src,
          select: function(e,ui){ 
              e.preventDefault(); 
              jQuery(this).val(ui.item.label); 
              jQuery(this).data('selectedItem',{code:ui.item.value, name:ui.item.name}); 
          }
        });
      })
      .catch(err => { 
          showError('managerBorrowErrorMessage','Lỗi tải danh mục vật tư: '+err.message); 
      });
}

// public/manager.js (THAY THẾ HÀM loadTechnicianData)

function loadTechnicianData(){
    var email = document.getElementById('technicianEmail').value;
    
    // === 1. SỬA ĐỔI: KHÔNG TỰ ĐÓNG TOGGLE NỮA ===
    // (Đã xóa dòng slideUp và removeClass active ở đây)
    // Giao diện sẽ giữ nguyên trạng thái Đóng/Mở hiện tại
    // ============================================
    
    // 2. Reset các ô nhập liệu bên trong
    document.getElementById('returnNoteSelect').value = '';
    document.getElementById('technicianNote').value = '';
    selectedReturnNoteItems = null;
    managerReturnItems = [];
    displayManagerReturnList();

    // 3. Force Reset giao diện Mượn (Vẫn cần thiết để tránh lỗi hiển thị)
    var directCheckbox = document.getElementById('directBorrow');
    var noteSelectDiv = document.getElementById('borrowNoteSelectDiv');
    var directNoteDiv = document.getElementById('directBorrowNoteDiv');

    if (directCheckbox) {
        directCheckbox.checked = false; // Tắt checkbox
    }
    if (noteSelectDiv) noteSelectDiv.style.display = 'block'; 
    if (directNoteDiv) directNoteDiv.style.display = 'none';
    
    // Đảm bảo nút từ chối hiển thị
    var rejectBtn = document.querySelector('#borrowRightPanel .action-footer button[onclick*="rejectBorrowNote"]');
    if (rejectBtn) rejectBtn.style.display = 'inline-block';

    if (!email){
        document.getElementById('managerOverviewBody').innerHTML='';
        document.getElementById('unusedItemsBody').innerHTML='<tr><td colspan="5">Vui lòng chọn kỹ thuật viên</td></tr>';
        document.getElementById('ticketRangesBody').innerHTML='';
        return;
    }
    
    // 4. Tải dữ liệu
    loadManagerDashboard(email); 
    
    // 5. Tải Dải Số (Chỉ Admin)
    if (userRoles.admin) {
        loadTicketRanges();
    } else {
        var rangeBody = document.getElementById('ticketRangesBody');
        if(rangeBody) rangeBody.innerHTML = '';
    }
    
    // 6. Tải dữ liệu trả (nếu đang ở tab Trả)
    // (Logic này giúp refresh lại bảng trả nếu đang mở tab trả)
    var returnModeActive = document.getElementById('returnUnusedMode').checked;
    if (returnModeActive) {
        loadUnusedItems();
    }
}

function loadManagerDashboard(email) {
    document.getElementById('technicianSpinner').style.display='block';
    document.getElementById('managerOverviewBody').innerHTML='<tr><td colspan="7">Đang tải...</td></tr>';
    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            borrowNotes = payload.pendingNotes || []; 
            pendingReturnNotes = payload.pendingReturnNotes || [];
            displayBorrowNotes();
            displayReturnNotes(pendingReturnNotes);
            displayBorrowedItems(payload.items || [], true, email);
        })
        .finally(() => {
            document.getElementById('technicianSpinner').style.display='none';
        });
}

function displayBorrowedItems(items, isManagerView, email){
    var overviewBody = document.getElementById('managerOverviewBody');
    overviewBody.innerHTML='';

    currentNegativeItems = []; // <-- Reset danh sách
    let itemsShownInOverview = 0; 

    items.forEach(function(item){
      var remaining = item.remaining || 0; 

      if (remaining < 0) { // <-- Nếu bị âm
          currentNegativeItems.push(item); // <-- Lưu lại
      }

      if (remaining > 0 || remaining < 0 || (item.unreconciledUsageDetails && item.unreconciledUsageDetails.length > 0)) {
          itemsShownInOverview++;
          var row=document.createElement('tr');
          var unreFull = (item.unreconciledUsageDetails||[]).map(function(u){ return '<span class="unreconciled">Sổ '+u.ticket+': '+u.quantity+' ('+(u.note||'-')+')</span>'; }).join('<br>') || 'Chưa có';

          let actionHtml = '';
          if (remaining < 0 && userRoles.admin) {
              const amountToFix = Math.abs(remaining);
              const itemNameEscaped = (item.name || '').replace(/'/g, "\\'");
              actionHtml = `<button 
                              onclick="fixNegativeInventory('${email}', '${item.code}', '${itemNameEscaped}', ${amountToFix})"
                              style="background-color: var(--error-color);">
                                Sửa (Về 0)
                            </button>`;
          }

          row.innerHTML = '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                        '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
                        '<td data-label="Tổng mượn">'+item.quantity+'</td>'+
                        '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                        '<td data-label="Đã trả">'+item.totalReturned+'</td>'+ 
                        '<td data-label="Còn lại">'+remaining+'</td>'+ 
                        '<td data-label="Chi tiết số sổ">'+unreFull+'</td>' +
                        '<td data-label="Hành động">' + actionHtml + '</td>';

          overviewBody.appendChild(row);
      }
    });

    if (itemsShownInOverview === 0) {
        overviewBody.innerHTML = `<tr><td colspan="8">Không có vật tư nào đang nợ.</td></tr>`;
    }

    // === HIỂN THỊ NÚT SỬA TẤT CẢ (NẾU CÓ) ===
    const fixAllBtn = document.getElementById('fix-all-negative-btn');
    if (fixAllBtn) {
        fixAllBtn.style.display = (currentNegativeItems.length > 0 && userRoles.admin) ? 'block' : 'none';
    }
}

function uploadExcel(){
    var fileInput=document.getElementById('excelFile');
    if (!fileInput.files[0]){ showError('excelErrorMessage','Vui lòng chọn file Excel.'); return; }
    document.getElementById('excelSpinner').style.display='block';
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        var sheet=wb.SheetNames[0];
        var json=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{ 
        header:['date','ticket','itemCode','itemName','quantity','note'],
        skipHeader:true 
        });
        if (!json.length){ showError('excelErrorMessage','File Excel trống.'); document.getElementById('excelSpinner').style.display='none'; return; }
        callApi('/manager/processExcelData', { data: json })
          .then(data => {
            processedExcelData = data;
            displayExcelData(data);
            document.getElementById('excelDataTable').style.display='table';
            document.getElementById('confirmExcelButton').style.display='inline-block';
          })
          .catch(err => { showError('excelErrorMessage','Lỗi xử lý: '+err.message); })
          .finally(() => { document.getElementById('excelSpinner').style.display='none'; });
      }catch(err){
        showError('excelErrorMessage','Lỗi đọc Excel: '+err.message);
        document.getElementById('excelSpinner').style.display='none';
      }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
}

function displayExcelData(excelData){
    var tbody=document.getElementById('excelDataBody');
    tbody.innerHTML='';
    if (!excelData||!excelData.length){
        tbody.innerHTML='<tr><td colspan="7">Không có dữ liệu hợp lệ.</td></tr>';
        return;
    }
    excelData.forEach(function(r){
        var tr=document.createElement('tr');
        tr.innerHTML=
            '<td data-label="Ngày">'+(r.date||'')+'</td>'+
            '<td data-label="Số sổ">'+(r.ticket||'')+'</td>'+
            '<td data-label="Mã vật tư">'+(r.itemCode||'')+'</td>'+
            '<td data-label="Tên vật tư">'+(r.itemName||'')+'</td>'+
            '<td data-label="Số lượng">'+(r.quantity||0)+'</td>'+
            '<td data-label="Email">'+(r.email||'Không xác định')+'</td>'+
            '<td data-label="Ghi chú">'+(r.note||'')+'</td>';
        tbody.appendChild(tr);
    });
    document.getElementById('excelDataTable').style.display='table';
    document.getElementById('confirmExcelButton').style.display='inline-block';
}

function confirmExcelData(){
    if (!processedExcelData || !processedExcelData.length){ showError('excelErrorMessage','Không có dữ liệu để lưu.'); return; }
    document.getElementById('excelSpinner').style.display='block';
    callApi('/manager/saveExcelData', { data: processedExcelData })
      .then(() => {
        showSuccess('excelSuccessMessage','Lưu dữ liệu thành công!');
        processedExcelData=[];
        document.getElementById('excelDataBody').innerHTML='';
        document.getElementById('excelDataTable').style.display='none';
        document.getElementById('confirmExcelButton').style.display='none';
        document.getElementById('excelFile').value='';
      })
      .catch(err => { showError('excelErrorMessage','Lỗi lưu: '+err.message); })
      .finally(() => { document.getElementById('excelSpinner').style.display='none'; });
}

function displayBorrowNotes(){
    var select=document.getElementById('borrowNoteSelect');
    select.innerHTML='<option value="">Chọn lệnh mượn</option>';
    var statusText = ' (Đang xử lý...)'; 
    (borrowNotes||[]).forEach(function(n){
        var o=document.createElement('option');
        o.value=n.timestamp; 
        o.text='✅ ['+n.date+'] '+n.note + statusText; 
        select.appendChild(o);
    });
    document.getElementById('technicianNote').value='';
}

function displaySelectedNote(){
    var ts=document.getElementById('borrowNoteSelect').value;
    var n=(borrowNotes||[]).find(function(x){return x.timestamp===ts;});
    document.getElementById('technicianNote').value = n ? n.note : '';
}

function toggleBorrowInput(){
    var direct = document.getElementById('directBorrow').checked;
    
    // Nếu "Nhập trực tiếp" = TRUE -> Ẩn dropdown chọn lệnh, Hiện note trực tiếp
    // Nếu "Nhập trực tiếp" = FALSE -> Hiện dropdown chọn lệnh, Ẩn note trực tiếp
    
    var noteSelectDiv = document.getElementById('borrowNoteSelectDiv');
    var directNoteDiv = document.getElementById('directBorrowNoteDiv');
    
    if (noteSelectDiv) {
        // Dùng setAttribute để ghi đè mọi style inline cũ
        if (direct) noteSelectDiv.setAttribute('style', 'display: none !important');
        else noteSelectDiv.setAttribute('style', 'display: block !important; background-color: #fff3cd; border: 1px dashed #ffeeba; padding: 15px; border-radius: 8px; margin-bottom: 15px;');
    }
    if (directNoteDiv) directNoteDiv.style.display = direct ? 'block' : 'none';
    
    // Reset giá trị khi chuyển chế độ
    if (direct){ 
        document.getElementById('borrowNoteSelect').value = ''; 
        document.getElementById('technicianNote').value = ''; 
    } else { 
        document.getElementById('managerBorrowNote').value = ''; 
    }
    
    // Ẩn/Hiện nút Từ chối (Chỉ hiện khi duyệt lệnh KTV)
    // Tìm nút từ chối trong footer của borrowRightPanel
    var rejectBtn = document.querySelector('#borrowRightPanel .action-footer button[onclick*="toggleRejectInput"]');
    if (rejectBtn) {
         rejectBtn.style.display = direct ? 'none' : 'inline-block';
    }
}

function toggleReturnUnusedMode() {
    var isBorrow = document.getElementById('borrowMode').checked;

    // Hiển thị cột trái
    document.getElementById('borrowLeftControls').style.display = isBorrow ? 'block' : 'none';
    document.getElementById('returnLeftControls').style.display = isBorrow ? 'none' : 'block';

    // Hiển thị cột phải
    document.getElementById('borrowRightPanel').style.display = isBorrow ? 'block' : 'none';
    document.getElementById('returnRightPanel').style.display = isBorrow ? 'none' : 'block';

    // Logic tải dữ liệu khi chuyển sang tab Trả
    if (!isBorrow) {
        loadUnusedItems();
        // Mặc định ẩn input lý do từ chối khi chuyển tab
        document.getElementById('returnRejectionReason').style.display = 'none';
    } else {
        document.getElementById('borrowRejectionReason').style.display = 'none';
    }
}

function addManagerItem(){
    var search=jQuery('#managerItemSearch');
    var item=search.data('selectedItem');
    var qty=parseFloat(document.getElementById('managerItemQuantity').value);
    if (!item||!qty||qty<=0){ showError('managerBorrowErrorMessage','Vui lòng chọn vật tư và số lượng hợp lệ.'); return; }
    managerSelectedItems.push({ code:item.code, name:item.name, quantity:qty });
    displayManagerSelectedItems();
    search.val(''); search.data('selectedItem',null);
    document.getElementById('managerItemQuantity').value='';
    showSuccess('managerBorrowSuccessMessage','Thêm vật tư thành công!');
}

function displayManagerSelectedItems(){
    var tbody=document.getElementById('managerSelectedItemsBody'); tbody.innerHTML='';
    (managerSelectedItems||[]).forEach(function(it,idx){
        var tr=document.createElement('tr');
        tr.innerHTML='<td data-label="Mã vật tư">'+it.code+'</td><td data-label="Tên vật tư">'+it.name+'</td><td data-label="Số lượng">'+it.quantity+'</td><td data-label="Xóa"><button onclick="removeManagerItem('+idx+')">Xóa</button></td>';
        tbody.appendChild(tr);
    });
}

function removeManagerItem(i){ managerSelectedItems.splice(i,1); displayManagerSelectedItems(); }

function submitManagerBorrow(){
    try{
        var email=document.getElementById('technicianEmail').value;
        var direct=document.getElementById('directBorrow').checked;
        var noteSelect=document.getElementById('borrowNoteSelect');
        var selectedTs = noteSelect ? noteSelect.value : '';
        var noteEl=document.getElementById('managerBorrowNote');
        var managerNote = noteEl ? (noteEl.value||'').trim() : '';
        let transactionDate = '';
        if (direct) {
            transactionDate = new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
        } else {
            var selectedNote = (borrowNotes||[]).find(function(x){return x.timestamp===selectedTs;});
            if (selectedNote && selectedNote.date) transactionDate = selectedNote.date;
        }
        if (!email || (managerSelectedItems||[]).length===0){ showError('managerBorrowErrorMessage','Vui lòng chọn kỹ thuật viên và thêm vật tư.'); return; }
        if (!direct && !selectedTs){ showError('managerBorrowErrorMessage','Vui lòng chọn lệnh mượn của KTV hoặc bật Nhập trực tiếp.'); return; }
        if (direct && !managerNote){ showError('managerBorrowErrorMessage','Vui lòng nhập ghi chú khi Nhập trực tiếp.'); return; }
        if (!transactionDate) { showError('managerBorrowErrorMessage','Lỗi: Không xác định được ngày giao dịch.'); return; }
        var items=(managerSelectedItems||[]).map(function(it){
            return { code:(it.code||'').toString().trim().toUpperCase(), name:(it.name||'').toString().trim(), quantity:Number(it.quantity)||0 };
        }).filter(function(it){ return it.code && it.quantity>0; });
        if (!items.length){ showError('managerBorrowErrorMessage','Không có vật tư hợp lệ.'); return; }
        var data={ timestamp:new Date().toISOString(), type:'Mượn', email:email, date: transactionDate, items:items, borrowTimestamp: selectedTs, mode: direct ? 'DIRECT' : 'NOTE', note: managerNote };
        document.getElementById('managerBorrowSpinner').style.display='block';
        callApi('/manager/submitBorrow', data)
            .then(() => {
                showSuccess('managerBorrowSuccessMessage', 'Gửi vật tư thành công!');
                managerSelectedItems = [];
                displayManagerSelectedItems();
                document.getElementById('managerBorrowNote').value = '';
                document.getElementById('borrowNoteSelect').value = '';
                document.getElementById('technicianNote').value = '';
                loadTechnicianData(); 
            })
            .catch(err => { showError('managerBorrowErrorMessage','Lỗi gửi vật tư: '+err.message); })
            .finally(() => { document.getElementById('managerBorrowSpinner').style.display='none'; });
    }catch(e){
        showError('managerBorrowErrorMessage','Lỗi: '+e.message);
        document.getElementById('managerBorrowSpinner').style.display='none';
    }
}

function submitManagerReturn(){
    // (Hàm này hiện không được dùng vì logic đã chuyển sang "Trả trực tiếp")
    console.warn("submitManagerReturn đã bị loại bỏ, dùng submitManagerReturnList hoặc approveReturnNote");
}

function loadUnusedItems(){
    var email = document.getElementById('technicianEmail').value;
    var tbody = document.getElementById('unusedItemsBody');
    if (!tbody) return;
    if (!email) { tbody.innerHTML = '<tr><td colspan="5">Vui lòng chọn kỹ thuật viên</td></tr>'; return; }
    const spinner = document.getElementById('returnUnusedSpinner');
    if (spinner) spinner.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div> Đang tải...</td></tr>';
    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            const items = payload.items || [];
            tbody.innerHTML = ''; 
            const returnableItems = items.filter(it => it.remaining > 0);
            if (returnableItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5">KTV này không nợ vật tư nào.</td></tr>';
            } else {
                returnableItems.forEach(function(it, index){
                    const remainingQty = it.remaining;
                    const safeName = (it.name || '').replace(/'/g, "\\'");
                    var tr = document.createElement('tr');
                    tr.dataset.code = it.code; 
                    tr.id = `return-item-row-${index}`; 
                    tr.innerHTML = `
                        <td data-label="Tên vật tư">${it.name || ''}</td>
                        <td data-label="Mã vật tư">${it.code || ''}</td>
                        <td data-label="Đang nợ" style="text-align: center;">${remainingQty}</td>
                        <td data-label="Số lượng trả">
                        <input type="number" class="quantity-return-input"
                               id="return-qty-input-${index}" 
                               data-index="${index}"
                               data-code="${it.code}"
                               data-name="${safeName}"
                               data-max="${remainingQty}"
                               min="0" max="${remainingQty}" value="">
                    </td>`;
                        // <td data-label="Thêm">
                        //     <button onclick="addManagerReturnItem('${index}', '${it.code}', '${it.name}', ${remainingQty})">+</button>
                        // </td>`;
                    tbody.appendChild(tr);
                });
            }
            highlightKtvRequestedReturnItems();
        })
        .catch(err => {
            showError('returnUnusedErrorMessage','Lỗi tải danh sách trả: '+ (err.message || 'Lỗi không xác định'));
            tbody.innerHTML='<tr><td colspan="5">Lỗi tải danh sách vật tư.</td></tr>';
        })
        .finally(() => {
            if (spinner) spinner.style.display = 'none';
        });
}

function approveReturnNote(){
    var email = document.getElementById('technicianEmail').value;
    // 1. SỬA LẤY NGÀY: Lấy từ ô hiển thị (directReturnDate), không phải ô ẩn
    var date = document.getElementById('directReturnDate').value;
    
    var selectedTs = document.getElementById('returnNoteSelect').value;
    
    // 2. SỬA LẤY VẬT TƯ: Lấy từ biến toàn cục, KHÔNG quét bảng HTML nữa
    var items = managerReturnItems; 

    if (!selectedTs) { showError('returnUnusedErrorMessage','Vui lòng chọn một note KTV để duyệt.'); return; }
    
    // Tự động điền ngày hôm nay nếu trống
    if (!date) {
        date = new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});
    }

    if (!email || !items || items.length === 0){ 
        showError('returnUnusedErrorMessage','Dữ liệu không hợp lệ (Thiếu KTV, Ngày hoặc Danh sách vật tư).'); 
        return; 
    }

    var data={ 
        timestamp: new Date().toISOString(), 
        type:'Trả', 
        email:email, 
        date:date, 
        items:items, 
        note: (document.getElementById('technicianReturnNote').value || '').trim(), 
        returnTimestamp: selectedTs 
    };
    
    document.getElementById('returnUnusedSpinner').style.display='block';
    
    callApi('/manager/submitReturn', data)
      .then(() => {
        showSuccess('returnUnusedSuccessMessage','Duyệt note trả thành công!');
        
        // Reset giao diện
        document.getElementById('directReturnDate').value = ''; // Reset ngày
        document.getElementById('returnNoteSelect').value = ''; 
        document.getElementById('technicianReturnNote').value = ''; 
        selectedReturnNoteItems = null;
        managerReturnItems = []; // Xóa danh sách tạm
        displayManagerReturnList();
        
        loadUnusedItems();
        loadManagerDashboard(email);
      })
      .catch(err => { 
        showError('returnUnusedErrorMessage','Lỗi duyệt note: '+err.message); 
      })
      .finally(() => { 
        document.getElementById('returnUnusedSpinner').style.display='none'; 
      });
}

function loadTicketRanges(){
    if (!userRoles.admin) return;
    var email=document.getElementById('technicianEmail').value;
    if (!email){ ticketRanges=[]; displayTicketRanges(); return; }
    document.getElementById('ticketRangeSpinner').style.display='block';
    callApi('/manager/ticketRanges', { email: email })
      .then(r => { ticketRanges=r||[]; displayTicketRanges(); })
      .catch(err => { showError('ticketRangeErrorMessage','Lỗi tải dải số: '+err.message); })
      .finally(() => { document.getElementById('ticketRangeSpinner').style.display='none'; });
}

function saveTicketRanges(){
    var email=document.getElementById('technicianEmail').value;
    if (!email){ showError('ticketRangeErrorMessage','Vui lòng chọn kỹ thuật viên.'); return; }
    document.getElementById('ticketRangeSpinner').style.display='block';
    callApi('/manager/saveTicketRanges', { email: email, ranges: ticketRanges })
      .then(() => { showSuccess('ticketRangeSuccessMessage','Lưu thành công!'); loadTicketRanges(); })
      .catch(err => { showError('ticketRangeErrorMessage','Lỗi lưu dải số: '+err.message); })
      .finally(() => { document.getElementById('ticketRangeSpinner').style.display='none'; });
}

function displayTicketRanges(){
    var tbody=document.getElementById('ticketRangesBody'); tbody.innerHTML='';
    (ticketRanges||[]).forEach(function(range,idx){
        var tr=document.createElement('tr');
        tr.innerHTML='<td data-label="Số bắt đầu">'+range.start+'</td><td data-label="Số kết thúc">'+range.end+'</td><td data-label="Xóa"><button onclick="removeTicketRange('+idx+')">Xóa</button></td>';
        tbody.appendChild(tr);
    });
}

function addTicketRange(){
    var s=parseInt(document.getElementById('ticketRangeStart').value,10);
    var e=parseInt(document.getElementById('ticketRangeEnd').value,10);
    if (!s||!e||s>e||s<=0){ showError('ticketRangeErrorMessage','Dải số không hợp lệ.'); return; }
    for (var i=0;i<ticketRanges.length;i++){ var r=ticketRanges[i]; if (s<=r.end && e>=r.start){ showError('ticketRangeErrorMessage','Dải số bị trùng.'); return; } }
    ticketRanges.push({start:s,end:e}); 
    ticketRanges.sort(function(a,b){return a.start-b.start;});
    displayTicketRanges();
    document.getElementById('ticketRangeStart').value=''; 
    document.getElementById('ticketRangeEnd').value='';
}

function removeTicketRange(i){ ticketRanges.splice(i,1); displayTicketRanges(); }

function loadKtvReturnItems() { /* (Hàm này chỉ dùng ở KTV) */ }
function submitKtvReturnItems() { /* (Hàm này chỉ dùng ở KTV) */ }

function displayReturnNotes(notes){
    var select=document.getElementById('returnNoteSelect');
    select.innerHTML='<option value="">-- Bỏ chọn (Để Trả hàng Trực tiếp) --</option>';
    var statusText = ' (Đang xử lý...)'; 
    (notes||[]).forEach(function(n){
        var o=document.createElement('option');
        o.value=n.timestamp; 
        o.text='⛔ ['+n.date+'] '+n.note + statusText; 
        select.appendChild(o);
    });
    document.getElementById('technicianReturnNote').value='';
}

function displaySelectedReturnNote(){
    var ts = document.getElementById('returnNoteSelect').value;
    
    // Lấy các phần tử cần ẩn/hiện
    var unusedTable = document.getElementById('unusedItemsTable');
    var unusedTableContainer = unusedTable ? unusedTable.closest('.table-scroll-container') : null;
    var addButton = document.querySelector('button[onclick="addSelectedItemsToReturnList()"]');
    var managerNote = document.getElementById('managerReturnNote');
    
    // Reset danh sách trả tạm thời
    managerReturnItems = [];

    if (!ts) {
        // --- TRƯỜNG HỢP 1: TRẢ TRỰC TIẾP (Bỏ chọn lệnh) ---
        
        // ==> HIỆN LẠI các bảng nhập liệu
        if(unusedTableContainer) unusedTableContainer.style.display = 'block';
        if(addButton) addButton.style.display = 'block';
        if(managerNote) managerNote.style.display = 'block';

        document.getElementById('technicianReturnNote').value = '';
        selectedReturnNoteItems = null;
        
        // Tải lại danh sách nợ gốc
        loadUnusedItems(); 
        // Xóa trắng bảng bên phải
        displayManagerReturnList(); 
        return;
    }
    
    // --- TRƯỜNG HỢP 2: DUYỆT LỆNH TRẢ (Có chọn lệnh) ---
    
    // ==> ẨN ĐI các bảng nhập liệu thừa
    if(unusedTableContainer) unusedTableContainer.style.display = 'none';
    if(addButton) addButton.style.display = 'none';
    if(managerNote) managerNote.style.display = 'none';

    var n = (pendingReturnNotes || []).find(function(x){ return x.timestamp === ts; });
    
    // 1. Điền ghi chú của KTV vào ô bên trái
    document.getElementById('technicianReturnNote').value = n ? n.note : '';
    
    // 2. Lấy danh sách vật tư KTV muốn trả
    selectedReturnNoteItems = n ? (n.items || []) : null; 
    
    // 3. Tự động điền vào bảng "Danh sách xác nhận trả"
    if (selectedReturnNoteItems) {
        managerReturnItems = selectedReturnNoteItems.map(item => ({
            code: item.code,
            name: item.name,
            quantityReturned: item.quantity || item.quantityReturned || 0 
        }));
    }
    
    // 4. Vẽ lại bảng xác nhận
    displayManagerReturnList(); 
}

function rejectReturnNote() {
    var selectedTs = document.getElementById('returnNoteSelect').value;
    var reason = (document.getElementById('returnRejectionReason').value || '').trim();
    var email = document.getElementById('technicianEmail').value;
    if (!selectedTs) { showError('returnUnusedErrorMessage','Vui lòng chọn note KTV.'); return; }
    if (!reason) { showError('returnUnusedErrorMessage','Vui lòng nhập lý do từ chối.'); return; }
    var data = { email: email, timestamp: selectedTs, reason: reason };
    document.getElementById('returnUnusedSpinner').style.display = 'block';
    callApi('/manager/rejectReturnNote', data)
        .then(() => {
            showSuccess('returnUnusedSuccessMessage', 'Đã từ chối note thành công!');
            document.getElementById('returnRejectionReason').value = '';
            document.getElementById('returnNoteSelect').value = '';
            document.getElementById('technicianNote').value = '';
            selectedReturnNoteItems = null;
            loadUnusedItems();
            loadManagerDashboard(email);
        })
        .catch(err => { showError('returnUnusedErrorMessage', 'Lỗi từ chối note: ' + err.message); })
        .finally(() => { document.getElementById('returnUnusedSpinner').style.display = 'none'; });
}

function rejectBorrowNote() {
    const selectedTs = document.getElementById('borrowNoteSelect').value;
    const reason = (document.getElementById('borrowRejectionReason').value || '').trim();
    const email = document.getElementById('technicianEmail').value;
    if (!selectedTs) { showError('managerBorrowErrorMessage', 'Vui lòng chọn một note mượn hàng để từ chối.'); return; }
    if (!email) { showError('managerBorrowErrorMessage', 'Vui lòng chọn Kỹ thuật viên.'); return; }
    if (!reason) { showError('managerBorrowErrorMessage', 'Vui lòng nhập lý do từ chối.'); return; }
    const data = { email: email, timestamp: selectedTs, reason: reason };
    document.getElementById('managerBorrowSpinner').style.display = 'block';
    callApi('/manager/rejectBorrowNote', data)
        .then(() => {
            showSuccess('managerBorrowSuccessMessage', 'Đã từ chối note thành công!');
            document.getElementById('borrowRejectionReason').value = '';
            document.getElementById('borrowNoteSelect').value = '';
            document.getElementById('technicianNote').value = '';
            document.getElementById('managerSelectedItemsBody').innerHTML = '';
            loadTechnicianData();
        })
        .catch(err => { showError('managerBorrowErrorMessage', 'Lỗi từ chối note: ' + err.message); })
        .finally(() => { document.getElementById('managerBorrowSpinner').style.display = 'none'; });
}

function loadPendingNotifications() {
    const notificationArea = document.getElementById('managerNotificationArea');
    const notificationText = document.getElementById('pendingCountsText');
    const spinner = document.getElementById('notificationSpinner');
    if (!notificationArea || !notificationText || !spinner) return;
    spinner.style.display = 'block';
    notificationArea.style.display = 'none';
    callApi('/manager/pendingCounts', {})
        .then(result => {
            const borrowEmails = result.pendingBorrowEmails || [];
            const returnEmails = result.pendingReturnEmails || [];
            let messages = [];
            if (borrowEmails.length > 0) {
                const borrowNames = borrowEmails.map(email => technicianMap.get(email) || email).join(', ');
                messages.push(`Lệnh mượn chờ duyệt: ${borrowNames}`);
            }
            if (returnEmails.length > 0) {
                const returnNames = returnEmails.map(email => technicianMap.get(email) || email).join(', ');
                messages.push(`Lệnh trả chờ duyệt: ${returnNames}`);
            }
            if (messages.length > 0) {
                notificationText.innerHTML = messages.join('<br>');
                notificationArea.style.display = 'block';
            } else {
                notificationArea.style.display = 'none';
            }
        })
        .catch(err => { console.error("Lỗi tải thông báo:", err); notificationArea.style.display = 'none'; })
        .finally(() => { spinner.style.display = 'none'; });
}

function loadTransferableItems() {
    const fromEmail = document.getElementById('transferFromTech').value;
    const tbody = document.getElementById('transferItemsBody');
    tbody.innerHTML = '<tr><td colspan="4"><div class="spinner"></div> Đang tải...</td></tr>';
    if (!fromEmail) { tbody.innerHTML = '<tr><td colspan="4">Vui lòng chọn Kỹ thuật viên chuyển</td></tr>'; return; }
    callApi('/dashboard', { technicianEmail: fromEmail })
        .then(payload => {
            const items = payload.items || [];
            tbody.innerHTML = '';
            const transferableItems = items.filter(it => it.remaining > 0);
            if (transferableItems.length === 0) { tbody.innerHTML = '<tr><td colspan="4">Kỹ thuật viên này không nợ vật tư nào.</td></tr>'; return; }
            transferableItems.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td data-label="Tên vật tư">${item.name || ''}</td>
                    <td data-label="Mã vật tư">${item.code || ''}</td>
                    <td data-label="Đang nợ" style="text-align: center;">${item.remaining}</td>
                    <td data-label="Số lượng chuyển">
                        <input type="number" class="transfer-quantity-input" min="0" max="${item.remaining}" value="0" data-code="${item.code}" data-name="${item.name}">
                    </td>`;
                tbody.appendChild(row);
            });
        })
        .catch(err => { tbody.innerHTML = `<tr><td colspan="4" class="error">Lỗi tải vật tư: ${err.message}</td></tr>`; });
}

function submitTransfer() {
    const fromEmail = document.getElementById('transferFromTech').value;
    const toEmail = document.getElementById('transferToTech').value;
    const transferDate = document.getElementById('transferDate').value;
    const itemsToTransfer = [];
    let validationError = false;
    if (!fromEmail || !toEmail || !transferDate) { showError('transferErrorMessage', 'Vui lòng chọn người chuyển, người nhận và ngày chuyển.'); return; }
    if (fromEmail === toEmail) { showError('transferErrorMessage', 'Người chuyển và người nhận phải khác nhau.'); return; }
    const inputs = document.querySelectorAll('#transferItemsBody .transfer-quantity-input');
    inputs.forEach(input => {
        if (validationError) return;
        const quantity = parseInt(input.value, 10) || 0;
        const max = parseInt(input.max, 10) || 0;
        const code = input.dataset.code;
        const name = input.dataset.name;
        if (quantity < 0 || quantity > max) { showError('transferErrorMessage', `Số lượng chuyển không hợp lệ cho vật tư ${code}.`); validationError = true; return; }
        if (quantity > 0) itemsToTransfer.push({ code, name, quantity });
    });
    if (validationError) return;
    if (itemsToTransfer.length === 0) { showError('transferErrorMessage', 'Vui lòng nhập số lượng cho ít nhất một vật tư.'); return; }
    const data = { fromEmail: fromEmail, toEmail: toEmail, date: transferDate, items: itemsToTransfer };
    showError('transferErrorMessage', '');
    showSuccess('transferSuccessMessage', '');
    document.getElementById('transferSpinner').style.display = 'block';
    callApi('/manager/transferItems', data)
        .then(() => {
            showSuccess('transferSuccessMessage', 'Chuyển vật tư thành công!');
            document.getElementById('transferFromTech').value = '';
            document.getElementById('transferToTech').value = '';
            document.getElementById('transferDate').value = '';
            document.getElementById('transferItemsBody').innerHTML = '<tr><td colspan="4">Vui lòng chọn Kỹ thuật viên chuyển</td></tr>';
            const currentSelectedTech = document.getElementById('technicianEmail').value;
            if (currentSelectedTech === fromEmail || currentSelectedTech === toEmail) loadTechnicianData();
        })
        .catch(err => { showError('transferErrorMessage', 'Lỗi chuyển vật tư: ' + err.message); })
        .finally(() => { document.getElementById('transferSpinner').style.display = 'none'; });
}

function formatManagerHistoryContent(doc) {
    let html = '';
    let statusHtml = '';
    let techDisplay = doc.email; 
    if (technicianMap.has(doc.email)) {
        const name = technicianMap.get(doc.email);
        if (name && name.trim() !== '') techDisplay = name;
    } else if (techniciansLoaded) {
         techDisplay = `${doc.email} (cũ)`;
    }
    html += `<strong>KTV:</strong> ${techDisplay}<br>`;
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
    return html;
}

function renderManagerHistoryTable() {
    const tbody = document.getElementById('managerHistoryBody'); 
    if (!tbody) return; 

    tbody.innerHTML = '';

    // XÓA BỘ LỌC CŨ (VÌ QUERY ĐÃ LỌC RỒI)

    if (managerHistoryCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Không có dữ liệu khớp với bộ lọc.</td></tr>';
        return;
    }

    managerHistoryCache.forEach(doc => { // Dùng cache trực tiếp
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'unreconciled' : 'success'; 
        tr.innerHTML = `
            <td data-label="Thời gian">${timestamp}</td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatManagerHistoryContent(doc)}</td>`;
        tbody.appendChild(tr);
    });
}

function listenForManagerHistory() {
    if (managerHistoryListener) managerHistoryListener(); // Dừng listener cũ

    managerHistoryCache = []; // XÓA CACHE CŨ
    managerHistoryLastDoc = null; // RESET PHÂN TRANG

    const spinner = document.getElementById('managerHistorySpinner');
    if (spinner) spinner.style.display = 'block';

    const loadMoreBtn = document.getElementById('loadMoreManagerHistory');
    if (loadMoreBtn) { loadMoreBtn.style.display = 'none'; loadMoreBtn.disabled = false; loadMoreBtn.innerText = 'Tải thêm'; }

    // ĐỌC GIÁ TRỊ LỌC
    const filterType = document.getElementById('managerHistoryFilterType').value;
    const filterTech = document.getElementById('managerHistoryFilterTech').value;

    // TẠO QUERY ĐỘNG
    let historyQuery = db.collection('history_transactions');
    if (filterTech !== 'Tất cả') {
        historyQuery = historyQuery.where('email', '==', filterTech);
    }
    if (filterType !== 'Tất cả') {
        historyQuery = historyQuery.where('type', '==', filterType);
    }
    historyQuery = historyQuery.orderBy('timestamp', 'desc').limit(HISTORY_PAGE_SIZE);

    console.log(`[Manager History] Đang chạy query với Filter: Tech=${filterTech}, Type=${filterType}`);

    managerHistoryListener = historyQuery.onSnapshot(snapshot => {
        if (spinner) spinner.style.display = 'none'; 

        managerHistoryCache = []; // Xóa cache mỗi khi có snapshot (để giữ logic real-time đơn giản)

        snapshot.forEach(doc => {
            managerHistoryCache.push(doc.data());
        });

        const snapshotSize = snapshot.size;
        managerHistoryLastDoc = snapshotSize > 0 ? snapshot.docs[snapshotSize - 1] : null;

        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }

        renderManagerHistoryTable(); // Vẽ lại
    }, error => {
        console.error("Lỗi Manager History:", error);
        if (spinner) spinner.style.display = 'none';
    });
}

function highlightKtvRequestedReturnItems() {
    const tbody = document.getElementById('unusedItemsBody');
    if (!tbody) return;
    if (!selectedReturnNoteItems || selectedReturnNoteItems.length === 0) {
         tbody.querySelectorAll('tr.requested-return').forEach(row => row.classList.remove('requested-return'));
         tbody.querySelectorAll('.quantity-return-input').forEach(input => input.value = 0);
        return;
    }
    const requestedMap = new Map(selectedReturnNoteItems.map(item => [normalizeCode(item.code), item.quantity]));
    tbody.querySelectorAll('tr').forEach(row => {
        const rowCode = normalizeCode(row.dataset.code); 
        const input = row.querySelector('.quantity-return-input');
        if (rowCode && input) {
            if (requestedMap.has(rowCode)) {
                const requestedQty = requestedMap.get(rowCode);
                const maxQty = parseInt(input.max, 10);
                const fillQty = Math.min(requestedQty, maxQty);
                input.value = fillQty;
                row.classList.add('requested-return');
            } else {
                row.classList.remove('requested-return');
                input.value = 0;
            }
        }
    });
}

function addManagerReturnItem(index, code, name, maxQty) {
    const input = document.getElementById(`return-qty-input-${index}`);
    if (!input) return;
    document.getElementById('returnNoteSelect').value = '';
    if (selectedReturnNoteItems) { selectedReturnNoteItems = null; highlightKtvRequestedReturnItems(); }
    const qty = parseInt(input.value, 10) || 0;
    if (qty <= 0) { showError('returnUnusedErrorMessage', `Số lượng trả cho ${name} phải lớn hơn 0.`); return; }
    if (qty > maxQty) { showError('returnUnusedErrorMessage', `Số lượng trả cho ${name} không thể vượt quá ${maxQty}.`); return; }
    let isExisting = false;
    const existingItem = managerReturnItems.find(item => item.code === code);
    if (existingItem) { existingItem.quantityReturned = qty; isExisting = true; }
    else { managerReturnItems.push({ code: code, name: name, quantityReturned: qty }); }
    input.value = 0;
    showSuccess('returnUnusedSuccessMessage', `Đã thêm/cập nhật ${name} (SL: ${qty}).`);
    displayManagerReturnList();
    try {
        const tableBody = document.getElementById('managerReturnListBody');
        let rowToHighlight = isExisting ? Array.from(tableBody.querySelectorAll('tr')).find(row => row.cells[1] && row.cells[1].innerText === code) : tableBody.lastElementChild;
        if (rowToHighlight) {
            rowToHighlight.classList.remove('row-highlight'); 
            void rowToHighlight.offsetWidth; 
            rowToHighlight.classList.add('row-highlight'); 
            const tableElement = document.getElementById('managerReturnListTable');
            tableElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (e) { console.warn("Lỗi khi highlight/scroll:", e); }
}

function displayManagerReturnList() {
    const tbody = document.getElementById('managerReturnListBody');
    tbody.innerHTML = '';
    if (managerReturnItems.length === 0) { tbody.innerHTML = '<tr><td colspan="4">Danh sách trả trống.</td></tr>'; return; }
    managerReturnItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Tên vật tư">${item.name}</td>
            <td data-label="Mã vật tư">${item.code}</td>
            <td data-label="Số lượng trả">${item.quantityReturned}</td>
            <td data-label="Xóa"><button onclick="removeManagerReturnItem(${index})">Xóa</button></td>`;
        tbody.appendChild(tr);
    });
}

function removeManagerReturnItem(index) { managerReturnItems.splice(index, 1); displayManagerReturnList(); }

function submitManagerReturnList() {
    var email = document.getElementById('technicianEmail').value;
    var note = (document.getElementById('managerReturnNote').value || '').trim();
    
    // 1. KHAI BÁO BIẾN dateVal (Lấy giá trị từ ô input)
    var dateVal = document.getElementById('directReturnDate').value;

    if (!email) { showError('returnUnusedErrorMessage','Vui lòng chọn KTV.'); return; }
    if (managerReturnItems.length === 0) { showError('returnUnusedErrorMessage','Danh sách trả trống.'); return; }

    // 2. XỬ LÝ NGÀY THÁNG
    // Nếu ô nhập trống, tự động lấy ngày hôm nay gán vào dateVal
    if (!dateVal) {
        dateVal = new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});
    }

    var data = { 
        timestamp: new Date().toISOString(), 
        type: 'Trả', 
        email: email, 
        date: dateVal, // <-- Bây giờ biến này đã được định nghĩa ở trên
        items: managerReturnItems, 
        note: note || 'Quản lý trả vật tư không sử dụng', 
        returnTimestamp: '', 
        mode: 'MANAGER_DIRECT' 
    };

    const spinner = document.getElementById('returnUnusedSpinner');
    if (spinner) spinner.style.display = 'block';

    callApi('/submit/return', data)
      .then(() => {
        showSuccess('returnUnusedSuccessMessage', 'Xác nhận trả vật tư (trực tiếp) thành công!');
        // Reset form
        document.getElementById('directReturnDate').value = '';
        document.getElementById('managerReturnNote').value = '';
        managerReturnItems = [];
        displayManagerReturnList();
        loadUnusedItems(); 
        loadManagerDashboard(email);
      })
      .catch(err => {
        showError('returnUnusedErrorMessage', 'Lỗi xác nhận: ' + err.message);
      })
      .finally(() => {
        if (spinner) spinner.style.display = 'none';
      });
}

function loadMoreManagerHistory() {
    if (!managerHistoryLastDoc) return;
    const btn = document.getElementById('loadMoreManagerHistory');
    btn.disabled = true; btn.innerText = 'Đang tải...';

    // ĐỌC LẠI GIÁ TRỊ LỌC (QUAN TRỌNG)
    const filterType = document.getElementById('managerHistoryFilterType').value;
    const filterTech = document.getElementById('managerHistoryFilterTech').value;

    // TẠO QUERY ĐỘNG
    let nextQuery = db.collection('history_transactions');
    if (filterTech !== 'Tất cả') {
        nextQuery = nextQuery.where('email', '==', filterTech);
    }
    if (filterType !== 'Tất cả') {
        nextQuery = nextQuery.where('type', '==', filterType);
    }
    nextQuery = nextQuery.orderBy('timestamp', 'desc')
                         .startAfter(managerHistoryLastDoc)
                         .limit(HISTORY_PAGE_SIZE);

    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            managerHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => managerHistoryCache.push(doc.data())); // Nối vào cache
            renderManagerHistoryTable(); // Vẽ lại
        }
        btn.disabled = false; btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) btn.style.display = 'none';
    }).catch(err => {
        console.error("Lỗi tải thêm (Manager):", err);
        btn.disabled = false; btn.innerText = 'Lỗi! Thử lại';
    });
}

function loadGlobalInventoryOverview() {
    const tbody = document.getElementById('globalOverviewBody');
    const spinner = document.getElementById('globalOverviewSpinner');

    tbody.innerHTML = '<tr><td colspan="7">Đang tải...</td></tr>'; // Sửa colspan="7"
    spinner.style.display = 'block';

    callApi('/manager/global-overview', {})
        .then(overviewList => {
            tbody.innerHTML = '';
            if (!overviewList || overviewList.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7">Không có vật tư nào đang nợ.</td></tr>'; // Sửa colspan="7"
                return;
            }

            // (Không cần sắp xếp nữa, backend đã làm)

            overviewList.forEach(item => {
                const row = document.createElement('tr');
                const totalRemaining = item.remaining || 0;

                // === TẠO HTML CHO DANH SÁCH NỢ ===
                let debtorsHtml = (item.debtors || []).map(debtor => {
                    // Lấy tên KTV từ map (đã được tải lúc vào trang)
                    const name = technicianMap.get(debtor.email) || debtor.email;
                    const remaining = debtor.remaining;
                    const color = remaining < 0 ? 'var(--error-color)' : 'var(--primary-color)';
                    return `<span style="color: ${color};">${name}: ${remaining}</span>`;
                }).join('<br>');

                if (!debtorsHtml) debtorsHtml = '-';
                // === KẾT THÚC TẠO HTML ===

                row.innerHTML = `
                    <td data-label="Tên vật tư">${item.name}</td>
                    <td data-label="Mã vật tư">${item.code}</td>
                    <td data-label="Tổng mượn">${item.totalBorrowed}</td>
                    <td data-label="Tổng sử dụng">${item.totalUsed}</td>
                    <td data-label="Tổng trả">${item.totalReturned}</td>
                    <td data-label="Tổng còn nợ" style="font-weight: bold; color: ${totalRemaining < 0 ? 'var(--error-color)' : 'var(--success-color)'};">
                        ${totalRemaining}
                    </td>
                    <td data-label="KTV đang nợ">${debtorsHtml}</td> `;
                tbody.appendChild(row);
            });
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="7" class="error">Lỗi tải tổng quan: ${err.message}</td></tr>`; // Sửa colspan="7"
        })
        .finally(() => {
            spinner.style.display = 'none';
        });
}

async function submitSetRoles() {
    const email = document.getElementById('roleEmailInput').value;
    const isInventoryManager = document.getElementById('roleCheckboxInventoryManager').checked;
    const isSale = document.getElementById('roleCheckboxSale').checked;
    const isAuditor = document.getElementById('roleCheckboxAuditor').checked;
    if (!email) { showError('roleManagerErrorMessage', 'Vui lòng nhập email.'); return; }
    const rolesToSet = { inventory_manager: isInventoryManager, sale: isSale, auditor: isAuditor };
    const spinner = document.getElementById('roleManagerSpinner');
    spinner.style.display = 'block';
    showError('roleManagerErrorMessage', '');
    showSuccess('roleManagerSuccessMessage', '');
    try {
        const result = await callApi('/admin/setRole', { email: email, roles: rolesToSet });
        showSuccess('roleManagerSuccessMessage', result.message || `Cập nhật quyền cho ${email} thành công.`);
        document.getElementById('roleEmailInput').value = '';
        document.getElementById('roleCheckboxInventoryManager').checked = false;
        document.getElementById('roleCheckboxAuditor').checked = false;
    } catch (err) {
        showError('roleManagerErrorMessage', 'Lỗi cập nhật: ' + err.message);
    } finally {
        spinner.style.display = 'none';
    }
}

async function startQrScanner() {
    if (isQrScannerRunning) return;
    console.log("[QR] BƯỚC 1: Đã gọi startQrScanner() (Chế độ Nâng cao)");
    const overlay = document.getElementById('qr-scanner-overlay'); 
    if (!overlay) { console.error("[QR LỖI] Không tìm thấy 'qr-scanner-overlay'."); return; }
    overlay.style.display = 'flex'; 
    showError('managerBorrowErrorMessage', '');
    console.log("[QR] BƯỚC 2: Đã hiển thị overlay.");
    if (typeof Html5Qrcode === 'undefined') { console.error("[QR LỖI] Thư viện 'Html5Qrcode' (core) không tồn tại."); showError('managerBorrowErrorMessage', 'Lỗi tải thư viện QR.'); return; }
    html5QrCodeScanner = new Html5Qrcode("qr-reader");
    isQrScannerRunning = true; 
    console.log("[QR] BƯỚC 3: Đã khởi tạo core engine.");
    try {
        const cameras = await Html5Qrcode.getCameras();
        console.log("[QR] BƯỚC 4: Lấy danh sách camera:", cameras);
        if (!cameras || cameras.length === 0) throw new Error("Không tìm thấy camera nào.");
        let cameraId = null;
        const backCamera = cameras.find(camera => (camera.label && camera.label.toLowerCase().includes('back')) || camera.facingMode === 'environment');
        if (backCamera) { cameraId = backCamera.id; console.log("[QR] BƯỚC 5: Đã tìm thấy camera sau:", backCamera.label); }
        else { cameraId = cameras[cameras.length - 1].id; console.log("[QR] BƯỚC 5: Không tìm thấy camera 'back', dùng camera cuối cùng:", cameras[cameras.length - 1].label); }
        await html5QrCodeScanner.start(
            cameraId,
            { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.8); return { width: Math.max(50, s), height: Math.max(50, s) }; } },
            handleQrScanSuccess,
            handleQrScanError
        );
        console.log("[QR] BƯỚC 6: Camera đã khởi động.");
    } catch (err) {
        console.error("[QR LỖI] Không thể khởi động camera:", err);
        showError('managerBorrowErrorMessage', 'Lỗi camera: ' + err.message);
        await stopQrScanner(); 
    }
}

async function stopQrScanner() {
    const overlay = document.getElementById('qr-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    if (html5QrCodeScanner && isQrScannerRunning) {
        try {
            console.log("[QR] Đang gọi stop()...");
            await html5QrCodeScanner.stop();
            console.log("[QR] Camera đã dừng.");
        } catch (err) { console.warn("Lỗi khi dừng camera:", err); }
    }
    isQrScannerRunning = false;
    html5QrCodeScanner = null;
}

function handleQrScanSuccess(decodedText, decodedResult) {
    console.log(`Scan successful: ${decodedText}`);
    stopQrScanner();
    const scannedCode = normalizeCode(decodedText.trim());
    const foundItem = itemListCache.find(it => normalizeCode(it.code) === scannedCode);
    const errorEl = document.getElementById('qr-scan-error');
    if (foundItem) {
        const label = `${foundItem.code} - ${foundItem.name}`;
        const itemData = { code: foundItem.code, name: foundItem.name };
        const searchInput = jQuery('#managerItemSearch');
        searchInput.val(label);
        searchInput.data('selectedItem', itemData);
        document.getElementById('managerItemQuantity').focus();
        showSuccess('managerBorrowSuccessMessage', `Đã tìm thấy: ${foundItem.name}`);
        if (errorEl) errorEl.style.display = 'none';
    } else {
        console.warn(`Mã QR "${scannedCode}" không có trong danh mục.`);
        if (errorEl) {
             errorEl.innerText = `Lỗi: Mã "${scannedCode}" không tồn tại.`;
             errorEl.style.display = 'block';
             setTimeout(() => { if (errorEl) errorEl.style.display = 'none'; }, 3000);
        }
    }
}
/**
 * [ADMIN] Gọi API để sửa kho âm
 */
async function fixNegativeInventory(email, itemCode, itemName, amount) {
    const confirmMsg = `Bạn có chắc chắn muốn điều chỉnh kho cho KTV ${email}?\n` +
                       `Vật tư: ${itemName} (${itemCode})\n` +
                       `Số lượng đang âm: -${amount}\n` +
                       `Hệ thống sẽ tạo 1 giao dịch MƯỢN ${amount} để đưa số nợ về 0.`;
                       
    if (!confirm(confirmMsg)) {
        return;
    }

    const spinner = document.getElementById('technicianSpinner');
    if (spinner) spinner.style.display = 'block';

    try {
        await callApi('/manager/fix-negative-inventory', { 
            email: email, 
            itemCode: itemCode, 
            itemName: itemName, 
            amount: amount 
        });
        
        showSuccess('technicianSuccessMessage', `Đã điều chỉnh kho cho ${itemName} thành công!`);
        
        // Tải lại chỉ dữ liệu dashboard (tổng quan) để cập nhật bảng
        loadManagerDashboard(email);
        
    } catch (err) {
        showError('technicianErrorMessage', 'Lỗi điều chỉnh kho: ' + err.message);
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}
/**
 * [ADMIN] Gọi API để sửa TẤT CẢ kho âm (Hàng loạt)
 */
async function fixAllNegativeItems() {
    const email = document.getElementById('technicianEmail').value;
    if (!email) {
        showError('technicianErrorMessage', 'Vui lòng chọn KTV trước.');
        return;
    }

    if (!currentNegativeItems || currentNegativeItems.length === 0) {
        showError('technicianErrorMessage', 'Không tìm thấy vật tư âm nào.');
        return;
    }

    const confirmMsg = `Bạn có chắc chắn muốn điều chỉnh TOÀN BỘ ${currentNegativeItems.length} vật tư đang bị âm của KTV ${email} về 0 không?`;

    if (!confirm(confirmMsg)) {
        return;
    }

    const spinner = document.getElementById('technicianSpinner');
    if (spinner) spinner.style.display = 'block';

    try {
        // Gọi API mới
        await callApi('/manager/fix-negative-inventory-batch', { 
            email: email, 
            items: currentNegativeItems // Gửi toàn bộ danh sách
        });

        showSuccess('technicianSuccessMessage', `Đã điều chỉnh ${currentNegativeItems.length} vật tư thành công!`);

        // Tải lại dashboard để cập nhật
        loadManagerDashboard(email);

    } catch (err) {
        showError('technicianErrorMessage', 'Lỗi điều chỉnh hàng loạt: ' + err.message);
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}
// --- CÁC HÀM ĐIỀU KHIỂN GIAO DIỆN MỚI ---

// 1. Hàm chuyển Tab (được gọi khi click vào Tab)
function selectMode(mode) {
    // Cập nhật class active cho Tab
    document.querySelectorAll('.mode-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + mode).classList.add('active');

    // Cập nhật Radio button ẩn (để giữ logic cũ)
    if (mode === 'borrow') {
        document.getElementById('borrowMode').checked = true;
    } else {
        document.getElementById('returnUnusedMode').checked = true;
    }

    // Gọi hàm toggle để hiển thị đúng khung
    toggleReturnUnusedMode();
}
// 3. Hàm hiển thị ô nhập lý do từ chối
function toggleRejectInput(type) {
    var id = type === 'borrow' ? 'borrowRejectionReason' : 'returnRejectionReason';
    var el = document.getElementById(id);
    
    if (el.style.display === 'none') {
        el.style.display = 'block';
        el.focus();
        // Có thể thêm logic: đổi nút "Từ chối" thành "Xác nhận Từ chối" nếu muốn
    } else {
        // Nếu đã hiện rồi thì thực hiện từ chối luôn
        if (type === 'borrow') rejectBorrowNote();
        else rejectReturnNote();
    }
}

// 4. Hàm xử lý nút "Xác nhận Trả" chung (cho cả Trực tiếp và Duyệt Note)
function handleReturnSubmit() {
    var noteSelect = document.getElementById('returnNoteSelect');
    // Nếu có chọn Note -> Gọi hàm Duyệt Note
    if (noteSelect && noteSelect.value) {
        approveReturnNote();
    } else {
        // Nếu không -> Gọi hàm Trả Trực Tiếp
        submitManagerReturnList();
    }
}
/**
 * [MỚI] Quét tất cả ô nhập liệu và thêm vào danh sách trả hàng loạt
 */
function addSelectedItemsToReturnList() {
    const inputs = document.querySelectorAll('#unusedItemsTable .quantity-return-input');
    let addedCount = 0;
    let errorCount = 0;

    // Tự động bỏ chọn Note nếu đang chọn (để chuyển sang trả trực tiếp)
    const noteSelect = document.getElementById('returnNoteSelect');
    if (noteSelect && noteSelect.value) {
        noteSelect.value = '';
        selectedReturnNoteItems = null;
        highlightKtvRequestedReturnItems();
    }

    inputs.forEach(input => {
        const qty = parseInt(input.value, 10) || 0;
        
        if (qty > 0) {
            const max = parseInt(input.getAttribute('data-max'), 10);
            const code = input.getAttribute('data-code');
            const name = input.getAttribute('data-name'); // Tên đã được escape an toàn từ bước 2

            if (qty > max) {
                // Nếu nhập quá số lượng, tô đỏ ô input
                input.style.border = "2px solid red";
                errorCount++;
            } else {
                // Thêm vào mảng managerReturnItems
                input.style.border = ""; // Xóa viền đỏ nếu có
                
                let isExisting = false;
                const existingItem = managerReturnItems.find(item => item.code === code);
                
                if (existingItem) {
                    existingItem.quantityReturned = qty; // Cập nhật số lượng mới
                } else {
                    managerReturnItems.push({
                        code: code,
                        name: name,
                        quantityReturned: qty
                    });
                }
                
                // Reset ô nhập về rỗng sau khi thêm xong
                input.value = '';
                addedCount++;
            }
        }
    });

    if (errorCount > 0) {
        showError('returnUnusedErrorMessage', `Có ${errorCount} vật tư nhập quá số lượng cho phép. Vui lòng kiểm tra lại.`);
    } else if (addedCount > 0) {
        showSuccess('returnUnusedSuccessMessage', `Đã thêm ${addedCount} vật tư vào danh sách trả.`);
        displayManagerReturnList(); // Cập nhật bảng dưới
    } else {
        showError('returnUnusedErrorMessage', 'Vui lòng nhập số lượng ít nhất một vật tư.');
    }
}
function handleQrScanError(errorMessage) { /* (Bỏ qua lỗi "không tìm thấy") */ }


// === KHỞI ĐỘNG (Cho trang Manager) ===
document.addEventListener('DOMContentLoaded', function(){ 
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    
    // Bắt đầu quá trình xác thực
    attachAuthListener(authButton, signOutButton); 
    
    // Khởi tạo các thành phần UI
    initForm();
    toggleBorrowInput();
    // Kích hoạt Toggle Headers (copy từ app.js)
    jQuery(document).ready(function($) {
        // (Đây là logic toggle chung)
        $('.toggle-header').on('click', function() {
            var header = $(this);
            var content = header.next('.toggle-content');
            var contentId = content.attr('id');
            var parentId = content.parent().attr('id');
    
            if (!header.hasClass('active')) {
                if (contentId === 'returnContent') {
                     loadUnusedItems();
                } else if (parentId === 'globalOverviewSection') {
                     loadGlobalInventoryOverview();
                }
            }
            content.slideToggle(300);
            header.toggleClass('active');
        });
    });
});
/**
 * [ADMIN] Kiểm tra quyền hiện tại của user
 */
async function loadUserRolesForAdmin() {
    const email = document.getElementById('roleEmailInput').value.trim();
    if (!email) {
        showError('roleManagerErrorMessage', 'Vui lòng nhập email cần kiểm tra.');
        return;
    }

    const spinner = document.getElementById('roleManagerSpinner');
    if (spinner) spinner.style.display = 'block';
    
    // Xóa thông báo cũ
    showError('roleManagerErrorMessage', '');
    showSuccess('roleManagerSuccessMessage', '');

    try {
        // Gọi API lấy quyền
        const claims = await callApi('/admin/getUserRoles', { email: email });
        
        // Cập nhật trạng thái Checkbox dựa trên dữ liệu trả về
        document.getElementById('roleCheckboxInventoryManager').checked = !!claims.inventory_manager;
        document.getElementById('roleCheckboxSale').checked = !!claims.sale;
        document.getElementById('roleCheckboxAuditor').checked = !!claims.auditor;

        let roleText = [];
        if (claims.admin) roleText.push("Admin");
        if (claims.inventory_manager) roleText.push("Quản lý kho");
        if (claims.sale) roleText.push("Sale");
        if (claims.auditor) roleText.push("Kiểm duyệt");
        
        if (roleText.length === 0) roleText.push("Chưa có quyền gì");

        showSuccess('roleManagerSuccessMessage', `Đã tải quyền của ${email}: [ ${roleText.join(', ')} ]`);

    } catch (err) {
        console.error(err);
        showError('roleManagerErrorMessage', 'Lỗi: ' + err.message);
        
        // Reset checkbox nếu lỗi để tránh hiểu nhầm
        document.getElementById('roleCheckboxInventoryManager').checked = false;
        document.getElementById('roleCheckboxSale').checked = false;
        document.getElementById('roleCheckboxAuditor').checked = false;
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}