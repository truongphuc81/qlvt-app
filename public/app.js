// public/app.js (FINAL - Đã chuyển đổi hoàn toàn sang Fetch API)

const API_BASE_URL = 'https://us-central1-quan-ly-vat-tu-backend.cloudfunctions.net/app/api'; 
//const auth = firebase.auth();
//const provider = new firebase.auth.GoogleAuthProvider();
// DỮ LIỆU NGƯỜI DÙNG (CẦN ĐƯỢC CẬP NHẬT SAU XÁC THỰC FIREBASE AUTH)
let userEmail = '';
let technicianName = '';
let isManager = false;
let processedExcelData = [];
let techniciansLoaded = false;
let technicianMap = new Map();

// Biến trạng thái toàn cục
var selectedTickets = [];
var managerSelectedItems = [];
var borrowNotes = [];
var ticketRanges = [];
var excelData = [];
var currentPage = 1;
var pageSize = 10;
var pendingReturnNotes = [];

// =======================================================
// UTILS CHUNG & API CALL WRAPPER
// =======================================================
function signInWithGoogle() {
    // SỬ DỤNG signInWithPopup THAY VÌ signInWithRedirect
    auth.signInWithPopup(provider)
        .then((result) => {
            // Đăng nhập thành công.
            // onAuthStateChanged sẽ tự động xử lý user.
            console.log("Đăng nhập popup thành công.");
        })
        .catch((error) => {
            // Xử lý lỗi (ví dụ: user đóng popup)
            console.error("Lỗi signInWithPopup:", error.message);
            // Hiển thị lỗi cho người dùng biết
            if (error.code !== 'auth/popup-closed-by-user') {
                showError('infoErrorMessage', 'Lỗi đăng nhập: ' + error.message);
            }
        });
}

// Hàm gọi API riêng cho Auth (vì Auth không cần token)
async function callAuthApi(endpoint, data) {
    // Logic fetch tương tự callApi nhưng không cần header Auth ban đầu
    const headers = { 'Content-Type': 'application/json' };
    const response = await fetch(API_BASE_URL + endpoint, { method: 'POST', headers, body: JSON.stringify(data), });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Lỗi server.');
    return result.data;
}

// --- HÀM XỬ LÝ AUTH THÀNH CÔNG (MỚI) ---
// File: app.js

// File: app.js

function handleAuthSuccess(user) {
    // Ẩn nút đăng nhập và hiển thị nút Đăng xuất
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    const mainPage = document.getElementById('mainPage');
    const infoErrorMessage = document.getElementById('infoErrorMessage');

    // *** <<< BƯỚC 1: FIX MỚI - ẨN SPINNER NGAY LẬP TỨC >>> ***
    // Ẩn spinner ngay khi biết đã đăng nhập, không cần chờ API
    const infoSpinner = document.getElementById('infoSpinner');
    if (infoSpinner) {
        infoSpinner.style.display = 'none';
    }
    
    if (authButton) authButton.style.display = 'none';
    if (signOutButton) signOutButton.style.display = 'inline-block';
    if (mainPage) mainPage.style.display = 'block'; 
    
    if (infoErrorMessage) infoErrorMessage.style.display = 'none'; 
    
    userEmail = user.email;
    technicianName = user.displayName;
    document.getElementById('userEmail').innerText = userEmail;
    document.getElementById('technicianName').innerText = technicianName;

    // *** BƯỚC 2: GỌI API (VẪN CÓ THỂ BỊ TREO, NHƯNG UI ĐÃ CHẠY) ***
    callAuthApi('/auth/verifyAndRegister', { email: userEmail, name: technicianName })
        .then(res => {
            isManager = res.isManager;
            
            if (isManager && document.getElementById('managerPageButton')) {
                document.getElementById('managerPageButton').style.display = 'inline-block';
            }
            
            loadBorrowHistoryForLast5Days(); 
            loadSelfDashboard();
            
            toggleForm(); 
            if (isManager) {
                loadTechnicians();
                initItemSearch(); 
            }
        })
        .catch(err => {
            showError('infoErrorMessage', 'Lỗi kiểm tra vai trò: ' + err.message);
            loadSelfDashboard(); 
            toggleForm(); 
        });
        
    // *** BƯỚC 3: XÓA KHỐI .finally() Ở ĐÂY ***
    // (Vì chúng ta đã chuyển logic ẩn spinner lên trên)
}
function showSuccess(id,msg){ var e=document.getElementById(id); e.innerText=msg; e.style.display='block'; setTimeout(function(){e.style.display='none';},5000); }
function showError(id,msg){ var e=document.getElementById(id); e.innerText=msg; e.style.display='block'; setTimeout(function(){e.style.display='none';},5000); }

async function getFirebaseIdToken() {
    const user = auth.currentUser;
    if (user) {
        return user.getIdToken();
    }
    // Nếu không có người dùng, ta không thể lấy token.
    return null; 
}

async function getFirebaseIdToken() {
    const user = auth.currentUser;
    if (user) {
        return user.getIdToken();
    }
    // Nếu không có người dùng, ta không thể lấy token.
    return null; 
}

// --- HÀM GỌI API (ĐÃ SỬA) ---
async function callApi(endpoint, data = {}, method = 'POST') {
    const idToken = await getFirebaseIdToken(); // Lấy token
    
    // Nếu API không phải là Auth/Register và người dùng chưa có token, chặn yêu cầu
    if (!idToken && !endpoint.startsWith('/auth/')) { 
        showError('infoErrorMessage', 'Vui lòng đăng nhập để tiếp tục.');
        throw new Error("User not authenticated.");
    }
    
    const headers = {
        'Content-Type': 'application/json',
        // GỬI TOKEN LÊN GCF
        'Authorization': idToken ? 'Bearer ' + idToken : '', 
    };

    const response = await fetch(API_BASE_URL + endpoint, {
        method: method,
        headers: headers,
        body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok || result.error) {
        // Xử lý lỗi 401 nếu token hết hạn/không hợp lệ
        if (response.status === 401) {
            alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
            // TODO: Triển khai logic đăng xuất/đăng nhập lại ở đây
        }
        throw new Error(result.error || 'Lỗi server không xác định.');
    }
    return result.data; 
}


// =======================================================
// KHỞI TẠO VÀ CHUYỂN TRANG
// =======================================================

// File: app.js

// File: app.js

// File: app.js

function initForm(){

    const authButton = document.getElementById('authButton');
    const toggleButton = document.getElementById('tableViewToggle'); // Thêm dòng này
    document.getElementById('infoSpinner').style.display = 'block'; 

    console.log("Đang thiết lập Persistence (lưu trữ)...");

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(() => {
        console.log("Thiết lập Persistence thành công. Đang gắn Auth Listener...");
        return attachAuthListener(authButton); 
      })
      .catch((error) => {
        console.error("Lỗi setPersistence:", error);
        showError('infoErrorMessage', 'Lỗi khởi tạo Auth: ' + error.message);
        document.getElementById('infoSpinner').style.display = 'none';
      });
// Khởi tạo datepicker
    jQuery(function() {
        // Gộp tất cả selector vào một
        jQuery("#historyDate, #managerTransactionDate, #returnUnusedTransactionDate, #transferDate")
            .datepicker({ dateFormat: 'dd/mm/yy' }); // <-- Đảm bảo #transferDate có ở đây
    });
    // === BẮT ĐẦU THÊM KHỐI NÀY ===
    // Đọc và áp dụng lựa chọn chế độ xem bảng
    const savedView = localStorage.getItem('tableView');
    if (savedView === 'card') {
        document.body.classList.add('card-view-mobile');
        // if (toggleButton) toggleButton.textContent = 'Xem dạng Bảng cuộn';
    } else {
        // Mặc định là 'scroll'
        document.body.classList.remove('card-view-mobile');
        // if (toggleButton) toggleButton.textContent = 'Xem dạng Thẻ';
    }
    // === KẾT THÚC THÊM KHỐI ===

    document.getElementById('historyDate').addEventListener('change', function(){ currentPage=1; loadBorrowHistory(); });

    if (localStorage.getItem('darkMode')==='true') document.body.classList.add('dark-mode');
}

function attachAuthListener(authButton) {
    // Hàm này chứa logic onAuthStateChanged Y HỆT như cũ
    auth.onAuthStateChanged(user => {
        if (user) {
            // TRƯỜNG HỢP 1: User đã đăng nhập
            console.log("Auth State: Đã tìm thấy user.");
            handleAuthSuccess(user); // Hàm này sẽ tự ẩn spinner
        } else {
            // TRƯỜNG HỢP 2: User chưa đăng nhập
            console.log("Auth State: Không tìm thấy user. Hiển thị nút đăng nhập.");

            // Ẩn nội dung chính
            document.getElementById('mainPage').style.display = 'none';
            document.getElementById('managerPage').style.display = 'none';

            // Hiển thị nút đăng nhập
            if (authButton) {
                authButton.textContent = 'Đăng nhập bằng Gmail';
                authButton.style.display = 'inline-block';
                authButton.onclick = signInWithGoogle; // Trỏ tới hàm popup
            }

            // Cập nhật placeholder
            document.getElementById('userEmail').innerText = 'Chưa đăng nhập';
            document.getElementById('technicianName').innerText = 'Chưa đăng nhập';

            // TẮT SPINNER
            document.getElementById('infoSpinner').style.display = 'none'; 
        }
    });
}

function toggleDarkMode(){ document.body.classList.toggle('dark-mode'); localStorage.setItem('darkMode',document.body.classList.contains('dark-mode')); }
// File: app.js (Sửa hàm showManagerPage, khoảng dòng 217)

function showManagerPage(){
    document.getElementById('mainPage').style.display='none';
    document.getElementById('managerPage').style.display='block';
    if (!techniciansLoaded) loadTechnicians(); // Chỉ tải KTV lần đầu

    // === THÊM DÒNG NÀY ===
    loadPendingNotifications(); // Luôn tải thông báo khi vào trang QL
}
function showMainPage(){ 
    document.getElementById('managerPage').style.display='none'; 
    document.getElementById('mainPage').style.display='block'; 

    // === THÊM CÁC DÒNG SAU ĐỂ TẢI LẠI DỮ LIỆU ===

    // 1. Tải lại bảng Tổng quan và Đối chiếu sổ
    loadSelfDashboard(); 

    // 2. Tải lại bảng Lịch sử (tùy theo tab đang chọn)
    var type = document.getElementById('transactionType').value;
    if (type === 'Mượn') {
        loadBorrowHistoryForLast5Days(); // Tải lại lịch sử mượn
    } else {
        loadReturnHistory(); // Tải lại lịch sử trả
    }
}

function toggleForm(){
    var type=document.getElementById('transactionType').value;
    document.getElementById('borrowInputForm').style.display = (type==='Mượn')?'block':'none';
    document.getElementById('borrowHistoryForm').style.display = (type==='Mượn')?'block':'none';
    document.getElementById('returnForm').style.display = (type==='Trả')?'block':'none';
    
    if (type==='Trả') {
        loadSelfDashboard();
        loadReturnHistory();
    }
}


// =======================================================
// DASHBOARD & OVERVIEW (THAY THẾ getTechnicianDashboardData/getBorrowedItems)
// =======================================================

// public/app.js (Sửa lỗi loadSelfDashboard - Đảm bảo an toàn)

// File: app.js

function loadSelfDashboard(){
    document.getElementById('overviewSpinner').style.display='block';
    document.getElementById('returnSpinner').style.display='block';
    document.getElementById('infoErrorMessage').style.display = 'none'; 

    callApi('/dashboard', { technicianEmail: userEmail })
        .then(payload => {
            // *** THÊM DÒNG NÀY VÀO ***
            // (false = không phải giao diện quản lý)
            displayBorrowedItems(payload.items || [], false); 
        })
        .catch(err => {
            showError('overviewErrorMessage', 'Lỗi tải tổng quan: ' + err.message);
            showError('returnErrorMessage', 'Lỗi tải tổng quan: ' + err.message);
        })
        .finally(() => {
            document.getElementById('overviewSpinner').style.display='none';
            document.getElementById('returnSpinner').style.display='none';
        });
}

function loadManagerDashboard(email) {
    document.getElementById('technicianSpinner').style.display='block';
    document.getElementById('managerOverviewBody').innerHTML='<tr><td colspan="6">Đang tải...</td></tr>';

    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            borrowNotes = payload.pendingNotes || []; 
            pendingReturnNotes = payload.pendingReturnNotes || []; // <-- THÊM DÒNG NÀY
            
            displayBorrowNotes();
            displayReturnNotes(pendingReturnNotes); // <-- THÊM DÒNG NÀY
            
            displayBorrowedItems(payload.items || [], true);
        })
        .finally(() => {
            document.getElementById('technicianSpinner').style.display='none';
        });
}

function loadBorrowedItems() {
    loadSelfDashboard();
}


// =======================================================
// LỊCH SỬ (THAY THẾ getBorrowHistory...)
// =======================================================

function loadBorrowHistoryForLast5Days(){
    document.getElementById('historySpinner').style.display='block';
    // FIX: Đảm bảo history luôn có {history: [], totalPages: 0}
    callApi('/history/byemail', { email: userEmail, isLast5Days: true, currentPage: currentPage, pageSize: pageSize })
        .then(history => { 
            displayBorrowHistory(history.history); 
        })
        .catch(err => { 
            showError('historyErrorMessage','Lỗi tải lịch sử: '+err.message); 
            // Nếu lỗi, vẫn phải tắt spinner để không bị treo
            displayBorrowHistory([]); 
        })
        .finally(() => { 
            document.getElementById('historySpinner').style.display='none'; 
        });
}

function loadBorrowHistory(){
    var dateInput=document.getElementById('historyDate').value;
    if (!dateInput){ loadBorrowHistoryForLast5Days(); return; }
    
    var p=dateInput.split('-');
    var date=p[2]+'/'+p[1]+'/'+p[0]; // DD/MM/YYYY
    
    document.getElementById('historySpinner').style.display='block';
    callApi('/history/byemail', { email: userEmail, date: date, currentPage: currentPage, pageSize: pageSize })
        .then(history => { displayBorrowHistory(history.history); })
        .catch(err => { showError('historyErrorMessage','Lỗi tải lịch sử: '+err.message); })
        .finally(() => { document.getElementById('historySpinner').style.display='none'; });
}

function loadMoreHistory(){ currentPage++; var d=document.getElementById('historyDate').value; if (d) loadBorrowHistory(); else loadBorrowHistoryForLast5Days(); }

// File Code.gs: Sửa lỗi hiển thị lịch sử bị tách dòng
function displayBorrowHistory(history){
    var tbody=document.getElementById('borrowHistoryBody');
    // Don't clear immediately if loading more
    // tbody.innerHTML=''; // <-- REMOVED

    if (currentPage === 1) { // Clear only if it's the first page
        tbody.innerHTML = '';
    }

    if (!history||!history.length){
        if (currentPage === 1) { // Show message only if first page is empty
             tbody.innerHTML='<tr><td colspan="2">Không có lịch sử mượn hàng</td></tr>';
        }
        document.querySelector('#borrowHistoryForm button').style.display = 'none'; // Hide "Load More" if no results
        return;
    }

    history.forEach(function(entry){
      var note = entry.note || '';
      var itemsHtml = '';
      var hasItems = Object.keys(entry.itemsEntered).length > 0;

      // 1. Tạo danh sách vật tư (nếu có) - Bỏ mã vật tư
      if (hasItems) {
          itemsHtml = Object.values(entry.itemsEntered).map(function(it){
              return '— '+it.name+': '+it.quantity; // No item code here
          }).join('<br>');
      }

      // 2. Tạo HTML trạng thái (MỚI)
      var statusHtml = '';
      if (entry.status === 'Pending') {
          statusHtml = ' <span style="color: green; font-style: italic;">(Đang xử lý...)</span>'; // <-- ĐÃ SỬA
      } else if (entry.status === 'Rejected') {
          var reason = entry.reason ? (': ' + entry.reason) : '';
          statusHtml = ' <span style="color: red; font-style: italic;">(Bị từ chối' + reason + ')</span>'; // <-- ĐÃ SỬA
      }
      // Implicitly, 'Fulfilled' status has no specific text unless items are present

      // 3. Kết hợp note, trạng thái, và vật tư
      var finalNoteHtml = '';
      // Thêm gạch ngang nếu bị từ chối và có note
      var noteDisplay = (entry.status === 'Rejected' && note) ? `<s>${note}</s>` : note; 

      if (noteDisplay && hasItems) {
          // Note đã duyệt (có gạch ngang nếu bị từ chối) + Vật tư
          finalNoteHtml = noteDisplay + statusHtml + '<br><strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
      } else if (noteDisplay) {
          // Chỉ có note (có gạch ngang nếu bị từ chối) + Trạng thái
          finalNoteHtml = noteDisplay + statusHtml;
      } else if (hasItems) {
          // Chỉ có vật tư (mượn trực tiếp)
          finalNoteHtml = '<strong style="font-weight: bold; font-style: italic;">Vật tư đã mượn:</strong><br>' + itemsHtml;
      }

      if (!finalNoteHtml && !statusHtml) finalNoteHtml = 'Không có dữ liệu'; // Fallback

      var date=new Date(entry.timestamp).toLocaleString('vi-VN');
      var tr=document.createElement('tr');
      tr.innerHTML='<td data-label="Thời gian">'+date+'</td><td data-label="Nội dung mượn">'+finalNoteHtml+'</td>';
      tbody.appendChild(tr);
    });

    // Show or hide "Load More" button based on whether there might be more pages
    document.querySelector('#borrowHistoryForm button').style.display = history.length < 5 ? 'none' : 'block'; // Adjust '5' if pageSize changes
}

// ===== Logic hiển thị Tổng quan (Giữ nguyên) =====


function displayBorrowedItems(items, isManagerView){
    var overviewBody = isManagerView ? document.getElementById('managerOverviewBody') : document.getElementById('overviewBody');
    var returnBody   = document.getElementById('borrowedItemsBody'); // Bảng của KTV
    var reconciledBody = document.getElementById('reconciledTicketsBody'); // Bảng KTV (Đã đối chiếu)
    // Xóa nội dung cũ
    overviewBody.innerHTML='';
    if (!isManagerView) {
        returnBody.innerHTML='';
        if (reconciledBody) reconciledBody.innerHTML = ''; // <-- THÊM DÒNG NÀY
    }
    
    // Kiểm tra nếu không có dữ liệu
    // if (!items||!items.length){
    //   overviewBody.innerHTML='<tr><td colspan="6">Không có vật tư đã mượn</td></tr>';
    //   if (!isManagerView) returnBody.innerHTML='<tr><td colspan="4">Chưa có sổ cần đối chiếu</td></tr>'; // 4 cột
    //   if (isManagerView) managerReturnBody.innerHTML='<tr><td colspan="8">Không có vật tư đã mượn</td></tr>';
    //   return;
    // }

    // --- HIỂN THỊ BẢNG TỔNG QUAN ---
    items.forEach(function(item){
      var remaining = item.quantity - item.totalUsed;

      // Chỉ hiển thị trên Tổng quan nếu KTV vẫn còn nợ HOẶC còn sổ chưa đối chiếu
      if (item.quantity > 0 || item.totalUsed > 0) {
          var row=document.createElement('tr');
          let rowHtml = '';

          // *** BẮT ĐẦU THAY ĐỔI LOGIC ***
          if (isManagerView) {
              // --- Giao diện Quản lý (Giữ nguyên 6 cột) ---
              var unreFull = (item.unreconciledUsageDetails||[]).map(function(u){
                return '<span class="unreconciled">Sổ '+u.ticket+': '+u.quantity+' ('+(u.note||'-')+')</span>'; // Giữ note
              }).join('<br>') || 'Chưa có';

              rowHtml =
                '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+ // Giữ Code
                '<td data-label="Tổng mượn chưa trả">'+item.quantity+'</td>'+
                '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                '<td data-label="Số lượng cần trả">'+remaining+'</td>'+
                '<td data-label="Chi tiết số sổ">'+unreFull+'</td>'; // Giữ label cũ
          } else {
              // --- Giao diện Kỹ thuật viên (Còn 5 cột) ---
               var unreSimple = (item.unreconciledUsageDetails||[]).map(function(u){
                return '<span class="unreconciled">Sổ '+u.ticket+': '+u.quantity+'</span>'; // Bỏ note
              }).join('<br>') || 'Chưa có';

              rowHtml =
                '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                // '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+ // Bỏ Code
                '<td data-label="Tổng mượn chưa trả">'+item.quantity+'</td>'+
                '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                '<td data-label="Số lượng cần trả">'+remaining+'</td>'+
                '<td data-label="Số sổ">'+unreSimple+'</td>'; // Đổi label, dùng unreSimple
          }
          // *** KẾT THÚC THAY ĐỔI LOGIC ***

          row.innerHTML = rowHtml;
          overviewBody.appendChild(row);
      }
    });

    
    // --- HIỂN THỊ BẢNG ĐỐI CHIẾU ---

    if (!isManagerView){
        // *** LOGIC GOM NHÓM (CÓ SẮP XẾP) ***
        const tickets = {}; // Nơi gom nhóm
        const reconciledTickets = {}; // Đã đối chiếu (MỚI)
        // 1. Tái cấu trúc dữ liệu: Gom vật tư theo Sổ
        items.forEach(function(item) {
            (item.unreconciledUsageDetails || []).forEach(function(detail) {
                if (!tickets[detail.ticket]) {
                    tickets[detail.ticket] = {
                        ticket: detail.ticket,
                        // Trích xuất số sổ để sắp xếp
                        ticketNumber: parseInt((detail.ticket || 'Sổ 0').match(/\d+$/)[0], 10) || 0,
                        items: [] 
                    };
                }
                tickets[detail.ticket].items.push({
                    name: item.name,
                    code: item.code,
                    quantity: detail.quantity
                });
            });
            // *** THÊM KHỐI NÀY: Gom ĐÃ đối chiếu ***
            (item.reconciledUsageDetails || []).forEach(function(detail) { //)"]
                if (!reconciledTickets[detail.ticket]) {
                    reconciledTickets[detail.ticket] = {
                        ticket: detail.ticket,
                        ticketNumber: parseInt((detail.ticket || 'Sổ 0').match(/\d+$/)[0], 10) || 0,
                        items: [] 
                    };
                }
                reconciledTickets[detail.ticket].items.push({ name: item.name, code: item.code, quantity: detail.quantity });
            });
        });

        // 2. SẮP XẾP MẢNG CÁC SỔ
        const sortedTickets = Object.values(tickets).sort(function(a, b) {
            return a.ticketNumber - b.ticketNumber;
        });

        // 3. Render dữ liệu đã gom nhóm VÀ sắp xếp
        sortedTickets.forEach(function(ticket) {
            var rr = document.createElement('tr');
            
            // Tách Tên vật tư ra 1 chuỗi
            var itemsNameHtml = ticket.items.map(function(it) {
                return (it.name || 'N/A') + ' (' + (it.code || 'N/A') + ')';
            }).join('<br>');
            
            // Tách Số lượng ra 1 chuỗi
            var itemsQtyHtml = ticket.items.map(function(it) {
                return it.quantity;
            }).join('<br>');
            
            // Render 4 cột
            rr.innerHTML =
                '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
                '<td data-label="Tên vật tư">' + itemsNameHtml + '</td>' +
                '<td data-label="Số lượng sử dụng" style="text-align: center;">' + itemsQtyHtml + '</td>' +
                '<td data-label="Xác nhận đối chiếu"><input type="checkbox" class="ticket-checkbox" value="' + ticket.ticket + '"></td>';
            
            returnBody.appendChild(rr);
        });
        // 4. SẮP XẾP MẢNG ĐÃ ĐỐI CHIẾU (MỚI)
        const sortedReconciled = Object.values(reconciledTickets).sort(function(a, b) {
            return b.ticketNumber - a.ticketNumber; // Sắp xếp giảm dần (mới nhất lên trên)
        });

        // 5. RENDER MẢNG ĐÃ ĐỐI CHIẾU (MỚI)
        if (reconciledBody) {
            sortedReconciled.forEach(function(ticket) {
                var rRow = document.createElement('tr');
                var rItemsNameHtml = ticket.items.map(function(it) { return (it.name || 'N/A') + ' (' + (it.code || 'N/A') + ')'; }).join('<br>');
                var rItemsQtyHtml = ticket.items.map(function(it) { return it.quantity; }).join('<br>');
                
                rRow.innerHTML =
                    '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
                    '<td data-label="Tên vật tư">' + rItemsNameHtml + '</td>' +
                    '<td data-label="Số lượng sử dụng" style="text-align: center;">' + rItemsQtyHtml + '</td>';
                reconciledBody.appendChild(rRow);
            });
        }
        
        if (Object.keys(tickets).length === 0) {
             returnBody.innerHTML='<tr><td colspan="4">Chưa có sổ cần đối chiếu</td></tr>';
        }
        if (reconciledBody && Object.keys(reconciledTickets).length === 0) {
             reconciledBody.innerHTML='<tr><td colspan="3">Chưa có sổ đã đối chiếu</td></tr>';
        }

    }
    //else { // if (isManagerView)
    //     // *** LOGIC CŨ: GIỮ NGUYÊN CHO QUẢN LÝ (CHI TIẾT TỪNG VẬT TƯ) ***
    //     let hasUnreconciled = false;
    //     items.forEach(function(item){
    //         (item.unreconciledUsageDetails||[]).forEach(function(detail){
    //             hasUnreconciled = true;
    //             var remaining = item.quantity - item.totalUsed;
    //             var mr=document.createElement('tr');
    //             mr.innerHTML =
    //                 '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
    //                 '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
    //                 '<td data-label="Số lượng sử dụng">'+detail.quantity+'</td>'+
    //                 '<td data-label="Số lượng trả"><input type="number" class="quantity-return-input" min="0" value="0"></td>'+
    //                 '<td data-label="Số lượng còn lại">'+remaining+'</td>'+
    //                 '<td data-label="Số sổ">'+detail.ticket+'</td>'+
    //                 '<td data-label="Ghi chú">'+(detail.note||'-')+'</td>'+
    //                 '<td data-label="Xác nhận"><input type="checkbox" class="ticket-checkbox" value="'+detail.ticket+'"></td>';
    //             managerReturnBody.appendChild(mr);
    //         });
    //     });
        
    //     if (!hasUnreconciled) {
    //         managerReturnBody.innerHTML='<tr><td colspan="8">Không có vật tư đã mượn</td></tr>';
    //     }
    // }
}


// =======================================================
// SUBMIT FORMS (THAY THẾ submitData/submitErrorReport)
// =======================================================

function submitForm(){
    var type=document.getElementById('transactionType').value;
    if (type==='Mượn') submitBorrowForm(); else submitReturnForm();
}

function submitBorrowForm(){
    var note=(document.getElementById('borrowItems').value||'').trim();
    if (!note){ showError('borrowErrorMessage','Vui lòng nhập nội dung mượn.'); return; }
    var data={
      timestamp: new Date().toISOString(),
      type:'Mượn', email:userEmail, date: new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
      note:note
    };
    document.getElementById('borrowSpinner').style.display='block';
    
    callApi('/submit/borrow', data)
        .then(() => {
            showSuccess('borrowSuccessMessage','Gửi yêu cầu mượn thành công!');
            document.getElementById('borrowItems').value='';
            loadBorrowHistoryForLast5Days();
            loadSelfDashboard(); // Cần tải lại Dashboard để làm mới Pending Notes
        })
        .catch(err => {
            showError('borrowErrorMessage','Lỗi gửi yêu cầu: '+err.message);
        })
        .finally(() => {
            document.getElementById('borrowSpinner').style.display='none';
        });
}

// File: app.js (THAY THẾ HÀM NÀY)

function submitReturnForm(){
    selectedTickets=[];
    
    // Chỉ cần tìm các checkbox đã được chọn
    var checkboxes = document.querySelectorAll('#borrowedItemsTable .ticket-checkbox:checked');
    
    // Nếu không chọn checkbox nào, báo lỗi
    if (checkboxes.length === 0) {
        showError('returnErrorMessage','Vui lòng chọn ít nhất một số sổ để xác nhận.');
        return;
    }

    // Lấy giá trị (là số sổ) từ các checkbox
    checkboxes.forEach(function(cb){ 
        selectedTickets.push(cb.value); 
    });

    // Gửi dữ liệu. Backend chỉ cần 'tickets' để đối chiếu
    var data={
      timestamp: new Date().toISOString(), 
      type:'Trả', 
      email:userEmail,
      date: new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
      tickets: selectedTickets, // Mảng các số sổ đã chọn
      items: [] // Gửi mảng rỗng để backend phân biệt đây là 'Đối chiếu' (Reconcile)
    };
    
    document.getElementById('returnSpinner').style.display='block';
    
    callApi('/submit/return', data)
        .then(() => {
            showSuccess('returnSuccessMessage','Xác nhận đối chiếu thành công!');
            selectedTickets=[]; 
            loadSelfDashboard(); // Tải lại Dashboard
        })
        .catch(err => {
            showError('returnErrorMessage','Lỗi xác nhận: '+err.message);
        })
        .finally(() => {
            document.getElementById('returnSpinner').style.display='none';
        });
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
        .catch(err => {
            showError('errorReportErrorMessage','Lỗi gửi báo cáo: '+err.message);
        })
        .finally(() => {
            document.getElementById('errorReportSpinner').style.display='none';
        });
}

// =======================================================
// MANAGER AREA (ĐÃ HOÀN THIỆN LOGIC GỌI API)
// =======================================================

// File: app.js (Sửa hàm loadTechnicians, khoảng dòng 625)
function loadTechnicians(){
    techniciansLoaded = false;
    technicianMap.clear();
    document.getElementById('technicianSpinner').style.display='block';
    callApi('/manager/technicians')
        .then(techs => {
            var sel=document.getElementById('technicianEmail');
            var selFrom = document.getElementById('transferFromTech'); // <-- THÊM
            var selTo = document.getElementById('transferToTech');   // <-- THÊM

            sel.innerHTML='<option value="">Chọn kỹ thuật viên</option>';
            // Đảm bảo các select khác tồn tại trước khi set innerHTML
            if (selFrom) selFrom.innerHTML = '<option value="">-- Chọn người chuyển --</option>'; // <-- THÊM
            if (selTo) selTo.innerHTML = '<option value="">-- Chọn người nhận --</option>';     // <-- THÊM

            (techs||[]).forEach(function(t){
                const name = t.name || t.email;
                const text = t.name ? `${t.name} (${t.email})` : t.email;
                technicianMap.set(t.email, name);

                var o=document.createElement('option');
                o.value=t.email;
                o.text= text;

                sel.appendChild(o.cloneNode(true));
                // Chỉ thêm vào nếu select tồn tại (phòng trường hợp HTML chưa load kịp)
                if (selFrom) selFrom.appendChild(o.cloneNode(true)); // <-- THÊM
                if (selTo) selTo.appendChild(o.cloneNode(true));   // <-- THÊM
            });
            techniciansLoaded = true;
        })
        .catch(err => {
            showError('technicianErrorMessage','Lỗi tải danh sách KTV: '+err.message);
            techniciansLoaded = false;
        })
        .finally(() => {
            document.getElementById('technicianSpinner').style.display='none';
        });
}

function initItemSearch(){
    callApi('/manager/items')
      .then(items => {
        var src=(items||[]).map(function(it){ return {label: it.code+' - '+it.name, value: it.code, name: it.name}; });
        jQuery('#managerItemSearch').autocomplete({
          source: src,
          select: function(e,ui){ e.preventDefault(); jQuery(this).val(ui.item.label); jQuery(this).data('selectedItem',{code:ui.item.value, name:ui.item.name}); }
        });
      })
      .catch(err => { showError('managerBorrowErrorMessage','Lỗi tải danh mục: '+err.message); });
}

function loadTechnicianData(){
    var email=document.getElementById('technicianEmail').value;
    if (!email){
        // Logic reset form giữ nguyên
        return;
    }
    loadManagerDashboard(email); // Tải dashboard Manager với email đã chọn
}
// public/app.js (Bổ sung hàm uploadExcel)

function uploadExcel(){
    var fileInput=document.getElementById('excelFile');
    if (!fileInput.files[0]){ showError('excelErrorMessage','Vui lòng chọn file Excel.'); return; }
    document.getElementById('excelSpinner').style.display='block';
    
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        // Sử dụng thư viện XLSX đã được tải qua CDN để đọc file ở Client
        var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        var sheet=wb.SheetNames[0];
        // Đọc dữ liệu thành JSON với cấu trúc header đã định nghĩa
        var json=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{ 
        header:['date','ticket','itemCode','itemName','quantity','note'], // <-- THỨ TỰ MỚI
        skipHeader:true 
        });
        console.log('[DEBUG Frontend] Dữ liệu đọc từ Excel:', JSON.stringify(json, null, 2));
        if (!json.length){ showError('excelErrorMessage','File Excel trống.'); document.getElementById('excelSpinner').style.display='none'; return; }
        
        // GỌI API GCF để chuẩn hóa dữ liệu
        callApi('/manager/processExcelData', { data: json })
          .then(data => {
        // <-- THÊM LOG NÀY -->
        console.log('[DEBUG] Dữ liệu trả về từ /processExcelData:', JSON.stringify(data, null, 2)); 

        processedExcelData = data; // Gán vào biến toàn cục
        displayExcelData(data); // Hiển thị xem trước
        document.getElementById('excelDataTable').style.display='table';
        document.getElementById('confirmExcelButton').style.display='inline-block';
      })
          .catch(err => { 
            showError('excelErrorMessage','Lỗi xử lý: '+err.message); 
          })
          .finally(() => {
            document.getElementById('excelSpinner').style.display='none';
          });
          
      }catch(err){
        showError('excelErrorMessage','Lỗi đọc Excel: '+err.message);
        document.getElementById('excelSpinner').style.display='none';
      }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
}

// Bổ sung hàm Display Data
function displayExcelData(excelData){
    var tbody=document.getElementById('excelDataBody');
    tbody.innerHTML=''; // Xóa dữ liệu cũ

    if (!excelData||!excelData.length){
        tbody.innerHTML='<tr><td colspan="7">Không có dữ liệu hợp lệ.</td></tr>';
        return;
    }

    excelData.forEach(function(r){
        var tr=document.createElement('tr');
        // SỬA THỨ TỰ CÁC CỘT TD Ở ĐÂY CHO KHỚP VỚI TH TRONG HTML
        tr.innerHTML=
            '<td data-label="Ngày">'+(r.date||'')+'</td>'+
            '<td data-label="Số sổ">'+(r.ticket||'')+'</td>'+       // <-- CỘT 2 MỚI
            '<td data-label="Mã vật tư">'+(r.itemCode||'')+'</td>'+ // <-- CỘT 3 MỚI
            '<td data-label="Tên vật tư">'+(r.itemName||'')+'</td>'+ // <-- CỘT 4 MỚI
            '<td data-label="Số lượng">'+(r.quantity||0)+'</td>'+
            '<td data-label="Email">'+(r.email||'Không xác định')+'</td>'+
            '<td data-label="Ghi chú">'+(r.note||'')+'</td>';
        tbody.appendChild(tr);
    });

    // Hiển thị bảng và nút xác nhận
    document.getElementById('excelDataTable').style.display='table';
    document.getElementById('confirmExcelButton').style.display='inline-block';
}

// Bổ sung hàm Confirm Data
// File: app.js (Modify confirmExcelData)

function confirmExcelData(){
    // Use the correct global variable
    if (!processedExcelData || !processedExcelData.length){ // <-- CHANGE HERE
        showError('excelErrorMessage','Không có dữ liệu để lưu.'); 
        return;
    }
    
    document.getElementById('excelSpinner').style.display='block';
    
    // Send the correct data
    callApi('/manager/saveExcelData', { data: processedExcelData }) // <-- CHANGE HERE
      .then(() => {
        showSuccess('excelSuccessMessage','Lưu dữ liệu thành công!');
        
        // Clear the correct variable after saving
        processedExcelData=[]; // <-- CHANGE HERE 
        
        document.getElementById('excelDataBody').innerHTML='';
        document.getElementById('excelDataTable').style.display='none';
        document.getElementById('confirmExcelButton').style.display='none';
        document.getElementById('excelFile').value='';
      })
      .catch(err => {
        showError('excelErrorMessage','Lỗi lưu: '+err.message);
      })
      .finally(() => {
        document.getElementById('excelSpinner').style.display='none';
      });
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
    var direct=document.getElementById('directBorrow').checked;
    document.getElementById('borrowNoteSelectDiv').style.display = direct?'none':'block';
    document.getElementById('directBorrowNoteDiv').style.display = direct?'block':'none';
    if (direct){ document.getElementById('borrowNoteSelect').value=''; document.getElementById('technicianNote').value='';
}
    else { document.getElementById('managerBorrowNote').value=''; }
}

function toggleReturnUnusedMode(){
    var borrowMode=document.getElementById('borrowMode').checked;
    document.getElementById('borrowInputSection').style.display=borrowMode?'block':'none';
    document.getElementById('returnUnusedSection').style.display=borrowMode?'none':'block';
    if (!borrowMode) loadUnusedItems();
}

function addManagerItem(){
    var search=jQuery('#managerItemSearch');
    var item=search.data('selectedItem');
    var qty=parseFloat(document.getElementById('managerItemQuantity').value);
    if (!item||!qty||qty<=0){ showError('managerBorrowErrorMessage','Vui lòng chọn vật tư và số lượng hợp lệ.'); return;
    }
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
        var date=document.getElementById('managerTransactionDate').value;
        var direct=document.getElementById('directBorrow').checked;
        var noteSelect=document.getElementById('borrowNoteSelect');
        var selectedTs = noteSelect ? noteSelect.value : '';
        var noteEl=document.getElementById('managerBorrowNote');
        var managerNote = noteEl ? (noteEl.value||'').trim() : '';

        if (!email || !date || (managerSelectedItems||[]).length===0){
            showError('managerBorrowErrorMessage','Vui lòng chọn kỹ thuật viên, ngày giao dịch và thêm vật tư.');
            return;
        }
        if (!direct && !selectedTs){
            showError('managerBorrowErrorMessage','Vui lòng chọn lệnh mượn của kỹ thuật viên hoặc bật Nhập trực tiếp.');
            return;
        }
        if (direct && !managerNote){
            showError('managerBorrowErrorMessage','Vui lòng nhập ghi chú khi Nhập trực tiếp.');
            return;
        }

        var items=(managerSelectedItems||[]).map(function(it){
            return { code:(it.code||'').toString().trim().toUpperCase(), name:(it.name||'').toString().trim(), quantity:Number(it.quantity)||0 };
        }).filter(function(it){ return it.code && it.quantity>0; });
        
        if (!items.length){ showError('managerBorrowErrorMessage','Không có vật tư hợp lệ.'); return; }

        var data={ 
            timestamp:new Date().toISOString(), 
            type:'Mượn', 
            email:email, 
            date:date, 
            items:items,
            // Thêm các trường logic quản lý
            borrowTimestamp: selectedTs,
            mode: direct ? 'DIRECT' : 'NOTE',
            note: managerNote 
        };
        
        document.getElementById('managerBorrowSpinner').style.display='block';
        
        callApi('/manager/submitBorrow', data)
            .then(() => {
                showSuccess('managerBorrowSuccessMessage', 'Gửi vật tư thành công!');
                // Logic _afterConsume (dọn dẹp và tải lại)
                managerSelectedItems = [];
                displayManagerSelectedItems();
                document.getElementById('managerBorrowNote').value = '';
                document.getElementById('borrowNoteSelect').value = '';
                document.getElementById('technicianNote').value = '';
                loadTechnicianData(); // Tải lại dữ liệu (bao gồm Pending Notes)
            })
            .catch(err => {
                showError('managerBorrowErrorMessage','Lỗi gửi vật tư: '+err.message);
            })
            .finally(() => {
                document.getElementById('managerBorrowSpinner').style.display='none';
            });
    }catch(e){
        showError('managerBorrowErrorMessage','Lỗi: '+e.message);
        document.getElementById('managerBorrowSpinner').style.display='none';
    }
}

function submitManagerReturn(){
    selectedTickets=[];
    var items=[];
    var inputs=document.querySelectorAll('#managerBorrowedItemsTable .quantity-return-input');
    var valid=true;
    
    // Tái tạo logic lấy items và tickets từ form
    inputs.forEach(function(input){
      var tr=input.closest('tr');
      var code=tr.cells[1].innerText;
      var name=tr.cells[0].innerText;
      var qUsed=parseFloat(tr.cells[2].innerText)||0;
      var qRet =parseFloat(input.value)||0;
      var ticket=tr.cells[5].innerText;
      var checkbox = tr.querySelector('.ticket-checkbox:checked'); // Kiểm tra nếu ô được chọn
        
      if (qRet<0){ showError('managerReturnErrorMessage','Số lượng trả không hợp lệ.'); valid=false; return; }
        
      if (checkbox){
        selectedTickets.push(ticket); // Thêm ticket vào danh sách
        items.push({ code:code, name:name, quantityUsed:qUsed, quantityReturned:qRet, ticket: ticket }); 
      }
    });

    if (!valid || selectedTickets.length===0 || items.length===0){
        showError('managerReturnErrorMessage','Vui lòng chọn số sổ và nhập số lượng trả hợp lệ.');
        return;
    }

    var data={ 
        timestamp:new Date().toISOString(), 
        type:'Trả', 
        email:document.getElementById('technicianEmail').value, 
        date:document.getElementById('managerTransactionDate').value, 
        tickets:selectedTickets, 
        items:items 
    };
    
    document.getElementById('managerReturnSpinner').style.display='block';
    
    callApi('/manager/submitReturn', data)
        .then(() => {
            showSuccess('managerReturnSuccessMessage','Xác nhận đối chiếu thành công!');
            loadTechnicianData(); // Tải lại dữ liệu (bao gồm sổ đối chiếu)
            selectedTickets=[];
        })
        .catch(err => {
            showError('managerReturnErrorMessage','Lỗi xác nhận: '+err.message);
        })
        .finally(() => {
            document.getElementById('managerReturnSpinner').style.display='none';
        });
}

function loadUnusedItems(){
    var email=document.getElementById('technicianEmail').value;
    var tbody=document.getElementById('unusedItemsBody');
    if (!email){ tbody.innerHTML='<tr><td colspan="4">Vui lòng chọn kỹ thuật viên</td></tr>'; return; }
    document.getElementById('returnUnusedSpinner').style.display='block';
    
    // Yêu cầu API GCF trả về danh sách tồn kho mượn chưa trả
    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            const items = payload.items || [];
            tbody.innerHTML='';
            
            if (!items||!items.length){ tbody.innerHTML='<tr><td colspan="4">Không có vật tư đã mượn</td></tr>'; }
            else {
                items.forEach(function(it){
                    var max=Math.max(0, (it.quantity||0)); // Total quantity after reconciliation
                    var tr=document.createElement('tr');
                    tr.innerHTML='<td data-label="Tên vật tư">'+(it.name||'')+'</td><td data-label="Mã vật tư">'+(it.code||'')+'</td><td data-label="Số lượng đã mượn">'+max+'</td><td data-label="Số lượng trả"><input type="number" class="quantity-return-input" min="0" max="'+max+'" value="0"></td>';
                    tbody.appendChild(tr);
                });
            }
        })
        .catch(err => {
            showError('returnUnusedErrorMessage','Lỗi tải danh sách: '+err.message);
        })
        .finally(() => {
            document.getElementById('returnUnusedSpinner').style.display='none';
        });
}

function approveReturnNote(){
    var email=document.getElementById('technicianEmail').value;
    var date=document.getElementById('returnUnusedTransactionDate').value;
    var items=[];
    var valid=true;
    var inputs=document.querySelectorAll('#unusedItemsTable .quantity-return-input');
    
    // 1. Lấy thông tin note KTV
    var selectedTs = document.getElementById('returnNoteSelect').value;
    var techNote = (document.getElementById('technicianReturnNote').value || '').trim();

    // 2. Lặp qua bảng vật tư (Logic cũ)
    inputs.forEach(function(input){
      var tr=input.closest('tr');
      var code=tr.cells[1].innerText;
      var name=tr.cells[0].innerText;
      var qRet=parseFloat(input.value)||0;
      var max=parseFloat(input.max)||0;
      if (qRet<0 || qRet>max){ showError('returnUnusedErrorMessage','Số lượng trả không hợp lệ cho '+code); valid=false; return; }
      if (qRet>0) items.push({ code:code, name:name, quantityReturned:qRet, quantityUsed:0 });
    });
    
    if (!valid || !email || !date || !items.length){ showError('returnUnusedErrorMessage','Vui lòng chọn KTV, ngày và ít nhất một vật tư hợp lệ.');
    return; }

    // 3. *** LOGIC MỚI: Gán note ***
    // Nếu quản lý có chọn note (selectedTs) VÀ note đó có nội dung (techNote), thì dùng note của KTV.
    // Ngược lại, dùng note mặc định.
    const finalNote = (selectedTs && techNote) ? techNote : 'Trả vật tư không sử dụng';

    // 4. Tạo data object
    var data={ 
        timestamp:new Date().toISOString(), 
        type:'Trả', 
        email:email, 
        date:date, 
        items:items, 
        note: finalNote, // <-- ĐÃ SỬA
        returnTimestamp: selectedTs 
    };
    
    document.getElementById('returnUnusedSpinner').style.display='block';
    
    callApi('/submit/return', data) //
      .then(() => {
        showSuccess('returnUnusedSuccessMessage','Trả vật tư không sử dụng thành công!');
        document.getElementById('returnUnusedTransactionDate').value='';
        document.getElementById('returnNoteSelect').value = ''; 
        document.getElementById('technicianReturnNote').value = ''; 
        
        loadUnusedItems(); 
        loadTechnicianData();
      })
      .catch(err => {
        showError('returnUnusedErrorMessage','Lỗi xác nhận: '+err.message);
      })
      .finally(() => {
        document.getElementById('returnUnusedSpinner').style.display='none';
      });
}

function loadTicketRanges(){
    var email=document.getElementById('technicianEmail').value;
    if (!email){ ticketRanges=[]; displayTicketRanges(); return;
}
    document.getElementById('ticketRangeSpinner').style.display='block';
    callApi('/manager/ticketRanges', { email: email })
      .then(r => { 
        ticketRanges=r||[]; 
        displayTicketRanges(); 
      })
      .catch(err => { 
        showError('ticketRangeErrorMessage','Lỗi tải dải số: '+err.message); 
      })
      .finally(() => { 
        document.getElementById('ticketRangeSpinner').style.display='none'; 
      });
}

function saveTicketRanges(){
    var email=document.getElementById('technicianEmail').value;
    if (!email){ showError('ticketRangeErrorMessage','Vui lòng chọn kỹ thuật viên.'); return;
}
    document.getElementById('ticketRangeSpinner').style.display='block';
    callApi('/manager/saveTicketRanges', { email: email, ranges: ticketRanges })
      .then(() => { 
        showSuccess('ticketRangeSuccessMessage','Lưu thành công!'); 
        loadTicketRanges(); 
      })
      .catch(err => { 
        showError('ticketRangeErrorMessage','Lỗi lưu dải số: '+err.message); 
      })
      .finally(() => { 
        document.getElementById('ticketRangeSpinner').style.display='none'; 
      });
}
// public/app.js (Bổ sung các hàm UI/Logic còn thiếu)

// ... (Logic của hàm addManagerItem() kết thúc ở đây) ...

function displayManagerSelectedItems(){
    var tbody=document.getElementById('managerSelectedItemsBody'); tbody.innerHTML='';
    (managerSelectedItems||[]).forEach(function(it,idx){
        var tr=document.createElement('tr');
        tr.innerHTML='<td data-label="Mã vật tư">'+it.code+'</td><td data-label="Tên vật tư">'+it.name+'</td><td data-label="Số lượng">'+it.quantity+'</td><td data-label="Xóa"><button onclick="removeManagerItem('+idx+')">Xóa</button></td>';
        tbody.appendChild(tr);
    });
}
function removeManagerItem(i){ 
    managerSelectedItems.splice(i,1); 
    displayManagerSelectedItems(); 
}


// ===== Ticket Ranges Logic =====

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
    if (!s||!e||s>e||s<=0){ showError('ticketRangeErrorMessage','Dải số không hợp lệ.'); return;
    }
    // Logic kiểm tra trùng lặp
    for (var i=0;i<ticketRanges.length;i++){ 
        var r=ticketRanges[i]; 
        if (s<=r.end && e>=r.start){ 
            showError('ticketRangeErrorMessage','Dải số bị trùng.'); 
            return;
        } 
    }
    
    ticketRanges.push({start:s,end:e}); 
    ticketRanges.sort(function(a,b){return a.start-b.start;});
    displayTicketRanges();
    document.getElementById('ticketRangeStart').value=''; 
    document.getElementById('ticketRangeEnd').value='';
}

function removeTicketRange(i){ 
    ticketRanges.splice(i,1); 
    displayTicketRanges();
}

// File: app.js (THÊM CÁC HÀM NÀY VÀO CUỐI)

/**
 * Gửi yêu cầu (note) trả vật tư không sử dụng
 */
function submitReturnNote(){
    var note=(document.getElementById('returnNoteItems').value||'').trim();
    if (!note){ showError('returnNoteErrorMessage','Vui lòng nhập nội dung trả.'); return; }
    
    var data={
      timestamp: new Date().toISOString(),
      type:'Trả', 
      email:userEmail, 
      date: new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
      note:note,
      items: [] 
    };
    
    document.getElementById('returnNoteSpinner').style.display='block';
    
    callApi('/submit/return', data)
        .then(() => {
            showSuccess('returnNoteSuccessMessage','Gửi yêu cầu trả thành công!');
            
            // === BẮT ĐẦU CẬP NHẬT GIAO DIỆN TỨC THỜI ===
            var tbody = document.getElementById('returnHistoryBody');
            
            // Xóa dòng "Không có lịch sử" nếu có
            var firstRow = tbody.rows[0];
            if (firstRow && (firstRow.cells.length === 1 || (firstRow.cells[1] && firstRow.cells[1].innerText === 'Không có lịch sử trả hàng'))) {
                tbody.innerHTML = '';
            }

            var tr = document.createElement('tr');
            var date = new Date().toLocaleString('vi-VN');
            // Thêm trạng thái MÀU XANH
            var statusHtml = ' <span style="color: blue; font-weight: bold; font-style: italic">(Đang xử lý...)</span>';
            
            tr.innerHTML = '<td data-label="Thời gian">' + date + '</td>' +
                           '<td data-label="Nội dung trả">' + note + statusHtml + '</td>';
            
            tbody.prepend(tr); // Thêm vào đầu bảng
            // === KẾT THÚC CẬP NHẬT GIAO DIỆN ===
            
            document.getElementById('returnNoteItems').value='';
        })
        .catch(err => {
            showError('returnNoteErrorMessage','Lỗi gửi yêu cầu: '+err.message);
        })
        .finally(() => {
            document.getElementById('returnNoteSpinner').style.display='none';
        });
}

/**
 * Hiển thị danh sách các note trả hàng đang chờ
 */
function displayReturnNotes(notes){
    var select=document.getElementById('returnNoteSelect');
    select.innerHTML='<option value="">Chọn lệnh trả</option>';
    
    var statusText = ' (Đang xử lý...)'; 
    (notes||[]).forEach(function(n){
        var o=document.createElement('option');
        o.value=n.timestamp; 
        o.text='⛔ ['+n.date+'] '+n.note + statusText; 
        select.appendChild(o);
    });
    document.getElementById('technicianReturnNote').value='';
}

/**
 * Hiển thị nội dung note trả khi Quản lý chọn
 */
function displaySelectedReturnNote(){
    var ts=document.getElementById('returnNoteSelect').value;
    // Tìm trong biến global pendingReturnNotes (sẽ tạo ở bước sau)
    var n=(pendingReturnNotes||[]).find(function(x){return x.timestamp===ts;});
    document.getElementById('technicianReturnNote').value = n ? n.note : '';
}
// File: app.js (DÁN VÀO CUỐI FILE)

function rejectReturnNote() {
    var selectedTs = document.getElementById('returnNoteSelect').value;
    var reason = (document.getElementById('returnRejectionReason').value || '').trim();
    var email = document.getElementById('technicianEmail').value;

    if (!selectedTs) {
        showError('returnUnusedErrorMessage', 'Vui lòng chọn một note trả hàng để từ chối.');
        return;
    }
    if (!reason) {
        showError('returnUnusedErrorMessage', 'Vui lòng nhập lý do từ chối.');
        return;
    }

    var data = {
        email: email,
        timestamp: selectedTs, // timestamp của note cần từ chối
        reason: reason
    };

    document.getElementById('returnUnusedSpinner').style.display = 'block';

    // Gọi API endpoint mới
    callApi('/manager/rejectReturnNote', data)
        .then(() => {
            showSuccess('returnUnusedSuccessMessage', 'Đã từ chối note thành công!');
            document.getElementById('returnRejectionReason').value = '';
            document.getElementById('returnNoteSelect').value = '';
            document.getElementById('technicianReturnNote').value = '';
            loadTechnicianData(); // Tải lại, note sẽ biến mất khỏi danh sách
        })
        .catch(err => {
            showError('returnUnusedErrorMessage', 'Lỗi từ chối note: ' + err.message);
        })
        .finally(() => {
            document.getElementById('returnUnusedSpinner').style.display = 'none';
        });
}
/**
 * Tải lịch sử TRẢ hàng không sử dụng
 */
function loadReturnHistory(){
    document.getElementById('returnHistorySpinner').style.display='block';
    
    // Gọi API mới
    callApi('/history/return', { email: userEmail, currentPage: 1, pageSize: 50 }) // Tạm thời tải 50
        .then(history => { 
            displayReturnHistory(history.history); 
        })
        .catch(err => { 
            document.getElementById('returnHistoryBody').innerHTML = '<tr><td colspan="2">Lỗi tải lịch sử.</td></tr>';
        })
        .finally(() => { 
            document.getElementById('returnHistorySpinner').style.display='none'; 
        });
}

/**
 * Hiển thị lịch sử TRẢ hàng (Tương tự displayBorrowHistory)
 */
function displayReturnHistory(history){
    var tbody=document.getElementById('returnHistoryBody');
    tbody.innerHTML='';

    if (!history||!history.length){ tbody.innerHTML='<tr><td colspan="2">Không có lịch sử trả hàng</td></tr>'; return; }
    
    history.forEach(function(entry){
      var note = entry.note || '';
      var itemsHtml = '';
      var hasItems = Object.keys(entry.itemsEntered).length > 0;

      // 1. Tạo danh sách vật tư (nếu có)
      if (hasItems) {
          itemsHtml = Object.values(entry.itemsEntered).map(function(it){ 
              return '— '+it.name+' ('+it.code+'): '+it.quantity; 
          }).join('<br>');
      }

      // 2. Tạo HTML trạng thái (MÀU XANH/ĐỎ)
      var statusHtml = '';
      if (entry.status === 'Pending') {
          statusHtml = ' <span style="color: green; font-style: italic;">(Đang xử lý...)</span>'; // <-- ĐÃ SỬA
      } else if (entry.status === 'Rejected') {
          // Thêm lý do từ chối (nếu có)
          var reason = entry.reason ? (': ' + entry.reason) : '';
          statusHtml = ' <span style="color: red; font-style: italic;">(Bị từ chối' + reason + ')</span>'; // <-- ĐÃ SỬA
      }

      // 3. Kết hợp note, trạng thái, và vật tư
      var finalNoteHtml = '';
      // Thêm gạch ngang nếu bị từ chối và có note
      var noteDisplay = (entry.status === 'Rejected' && note) ? `<s>${note}</s>` : note; 

      if (noteDisplay && hasItems) {
          // Note đã duyệt (có gạch ngang nếu bị từ chối) + Vật tư
          finalNoteHtml = noteDisplay + statusHtml + '<br><strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
      } else if (noteDisplay) {
          // Chỉ có note (có gạch ngang nếu bị từ chối) + Trạng thái
          finalNoteHtml = noteDisplay + statusHtml;
      } else if (hasItems) {
          // Chỉ có vật tư (đã duyệt, không có note gốc)
          finalNoteHtml = '<strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
      }

      if (!finalNoteHtml) finalNoteHtml = 'Không có dữ liệu';
    
      var date=new Date(entry.timestamp).toLocaleString('vi-VN');
      var tr=document.createElement('tr');
      tr.innerHTML='<td data-label="Thời gian">'+date+'</td><td data-label="Nội dung trả">'+finalNoteHtml+'</td>'; 
      tbody.appendChild(tr);
    });
}
function toggleTableView() {
    const body = document.body;
    const isCardView = body.classList.toggle('card-view-mobile'); // Toggle và lấy trạng thái mới
    localStorage.setItem('tableView', isCardView ? 'card' : 'scroll'); // Lưu lựa chọn

    // Cập nhật text nút (Tùy chọn)
    // const toggleButton = document.getElementById('tableViewToggle');
    // if (toggleButton) {
    //     toggleButton.textContent = isCardView ? 'Xem dạng Bảng cuộn' : 'Xem dạng Thẻ';
    // }
    // File: app.js (Paste at the end)
}
function rejectBorrowNote() {
    const selectedTs = document.getElementById('borrowNoteSelect').value;
    const reason = (document.getElementById('borrowRejectionReason').value || '').trim();
    const email = document.getElementById('technicianEmail').value; // Get selected tech email

    if (!selectedTs) {
        showError('managerBorrowErrorMessage', 'Vui lòng chọn một note mượn hàng để từ chối.');
        return;
    }
    if (!email) {
         showError('managerBorrowErrorMessage', 'Vui lòng chọn Kỹ thuật viên.');
         return;
    }
    if (!reason) {
        showError('managerBorrowErrorMessage', 'Vui lòng nhập lý do từ chối.');
        return;
    }

    const data = {
        email: email,
        timestamp: selectedTs, // timestamp of the note to reject
        reason: reason
    };

    document.getElementById('managerBorrowSpinner').style.display = 'block';

    // Call the new API endpoint
    callApi('/manager/rejectBorrowNote', data)
        .then(() => {
            showSuccess('managerBorrowSuccessMessage', 'Đã từ chối note thành công!');
            // Clear related fields
            document.getElementById('borrowRejectionReason').value = '';
            document.getElementById('borrowNoteSelect').value = '';
            document.getElementById('technicianNote').value = '';
            document.getElementById('managerSelectedItemsBody').innerHTML = ''; // Clear items table
            // Reload technician data to refresh the borrow notes dropdown
            loadTechnicianData();
        })
        .catch(err => {
            showError('managerBorrowErrorMessage', 'Lỗi từ chối note: ' + err.message);
        })
        .finally(() => {
            document.getElementById('managerBorrowSpinner').style.display = 'none';
        });
}
// File: app.js (THAY THẾ HÀM NÀY, khoảng dòng 1435)

/**
 * Tải và hiển thị thông báo yêu cầu đang chờ cho Quản lý (chi tiết theo KTV)
 */
function loadPendingNotifications() {
    const notificationArea = document.getElementById('managerNotificationArea');
    const notificationText = document.getElementById('pendingCountsText');
    const spinner = document.getElementById('notificationSpinner');

    if (!notificationArea || !notificationText || !spinner) return;

    spinner.style.display = 'block';
    notificationArea.style.display = 'none';

    // Gọi API để lấy danh sách email
    callApi('/manager/pendingCounts', {})
        .then(result => {
            const borrowEmails = result.pendingBorrowEmails || [];
            const returnEmails = result.pendingReturnEmails || [];

            console.log('API Response for pendingCounts (Emails):', result); // Giữ lại log để debug

            let messages = [];

            // Tạo thông báo cho lệnh mượn
            if (borrowEmails.length > 0) {
                const borrowNames = borrowEmails.map(email => technicianMap.get(email) || email).join(', ');
                messages.push(`Lệnh mượn chờ duyệt: ${borrowNames}`);
            }

            // Tạo thông báo cho lệnh trả
            if (returnEmails.length > 0) {
                const returnNames = returnEmails.map(email => technicianMap.get(email) || email).join(', ');
                messages.push(`Lệnh trả chờ duyệt: ${returnNames}`);
            }

            // Hiển thị nếu có thông báo
            if (messages.length > 0) {
                // Dùng <br> nếu có cả 2 loại thông báo
                notificationText.innerHTML = messages.join('<br>');
                notificationArea.style.display = 'block';
            } else {
                notificationArea.style.display = 'none';
            }
        })
        .catch(err => {
            console.error("Lỗi tải thông báo:", err);
            notificationArea.style.display = 'none';
        })
        .finally(() => {
            spinner.style.display = 'none';
        });
}
/**
 * Tải danh sách vật tư KTV đang nợ để chuyển
 */
function loadTransferableItems() {
    const fromEmail = document.getElementById('transferFromTech').value;
    const tbody = document.getElementById('transferItemsBody');
    tbody.innerHTML = '<tr><td colspan="4"><div class="spinner"></div> Đang tải...</td></tr>';

    if (!fromEmail) {
        tbody.innerHTML = '<tr><td colspan="4">Vui lòng chọn Kỹ thuật viên chuyển</td></tr>';
        return;
    }

    callApi('/dashboard', { technicianEmail: fromEmail })
        .then(payload => {
            const items = payload.items || [];
            tbody.innerHTML = '';

            const transferableItems = items.filter(it => it.quantity > 0);

            if (transferableItems.length === 0) {
                 tbody.innerHTML = '<tr><td colspan="4">Kỹ thuật viên này không nợ vật tư nào.</td></tr>';
                 return;
            }

            transferableItems.forEach(item => {
                const row = document.createElement('tr');
                // Lưu ý data-label khớp với CSS và thead
                row.innerHTML = `
                    <td data-label="Tên vật tư">${item.name || ''}</td>
                    <td data-label="Mã vật tư">${item.code || ''}</td>
                    <td data-label="Đang nợ" style="text-align: center;">${item.quantity}</td>
                    <td data-label="Số lượng chuyển">
                        <input type="number" class="transfer-quantity-input" min="0" max="${item.quantity}" value="0" data-code="${item.code}" data-name="${item.name}">
                    </td>
                `;
                tbody.appendChild(row);
            });
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="4" class="error">Lỗi tải vật tư: ${err.message}</td></tr>`;
        });
}

/**
 * Gửi yêu cầu chuyển vật tư
 */
function submitTransfer() {
    const fromEmail = document.getElementById('transferFromTech').value;
    const toEmail = document.getElementById('transferToTech').value;
    const transferDate = document.getElementById('transferDate').value;
    const itemsToTransfer = [];
    let validationError = false; // Cờ để dừng nếu có lỗi

    if (!fromEmail || !toEmail || !transferDate) {
        showError('transferErrorMessage', 'Vui lòng chọn người chuyển, người nhận và ngày chuyển.');
        return;
    }
    if (fromEmail === toEmail) {
        showError('transferErrorMessage', 'Người chuyển và người nhận phải khác nhau.');
        return;
    }

    const inputs = document.querySelectorAll('#transferItemsBody .transfer-quantity-input');
    inputs.forEach(input => {
        // Nếu đã có lỗi trước đó, không xử lý tiếp input này
        if (validationError) return;

        const quantity = parseInt(input.value, 10) || 0;
        const max = parseInt(input.max, 10) || 0;
        const code = input.dataset.code;
        const name = input.dataset.name;

        if (quantity < 0 || quantity > max) {
            showError('transferErrorMessage', `Số lượng chuyển không hợp lệ cho vật tư ${code}. Phải từ 0 đến ${max}.`);
            validationError = true; // Đặt cờ lỗi
            return; // Dừng xử lý input này
        }

        if (quantity > 0) {
            itemsToTransfer.push({ code, name, quantity });
        }
    });

    // Nếu có lỗi validation, dừng hàm
    if (validationError) {
        return;
    }

    if (itemsToTransfer.length === 0) {
         showError('transferErrorMessage', 'Vui lòng nhập số lượng cho ít nhất một vật tư để chuyển.');
         return;
    }

    const data = {
        fromEmail: fromEmail,
        toEmail: toEmail,
        date: transferDate,
        items: itemsToTransfer
    };

    // Xóa thông báo lỗi cũ trước khi gửi
    showError('transferErrorMessage', '');
    showSuccess('transferSuccessMessage', '');
    document.getElementById('transferSpinner').style.display = 'block';

    callApi('/manager/transferItems', data)
        .then(() => {
            showSuccess('transferSuccessMessage', 'Chuyển vật tư thành công!');
            // Reset form
            document.getElementById('transferFromTech').value = '';
            document.getElementById('transferToTech').value = '';
            document.getElementById('transferDate').value = '';
            document.getElementById('transferItemsBody').innerHTML = '<tr><td colspan="4">Vui lòng chọn Kỹ thuật viên chuyển</td></tr>';
            // Tải lại dashboard của KTV đang chọn (nếu là A hoặc B) để cập nhật Tổng quan
            const currentSelectedTech = document.getElementById('technicianEmail').value;
            if (currentSelectedTech === fromEmail || currentSelectedTech === toEmail) {
                loadTechnicianData();
            }
        })
        .catch(err => {
            showError('transferErrorMessage', 'Lỗi chuyển vật tư: ' + err.message);
        })
        .finally(() => {
            document.getElementById('transferSpinner').style.display = 'none';
        });
}
// DOM ready
document.addEventListener('DOMContentLoaded', function(){ initForm(); });
