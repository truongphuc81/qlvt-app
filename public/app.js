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
let managerHistoryListener = null; // Listener của Quản lý
let managerHistoryCache = [];    // Cache của Quản lý
let ktvHistoryListener = null;     // Listener của KTV (MỚI)
let ktvHistoryCache = [];      // Cache của KTV (MỚI)
let selectedReturnNoteItems = null;
let isAuditor = false; // <-- THÊM DÒNG NÀY
let auditorHistoryListener = null; // <-- THÊM DÒNG NÀY
let auditorHistoryCache = [];    // <-- THÊM DÒNG NÀY
const HISTORY_PAGE_SIZE = 15; // <-- THÊM DÒNG NÀY
let ktvHistoryLastDoc = null; // <-- THÊM DÒNG NÀY
let managerHistoryLastDoc = null; // <-- THÊM DÒNG NÀY
let auditorHistoryLastDoc = null; // <-- THÊM DÒNG NÀY
let allReconciledTicketsCache = []; // <-- THÊM DÒNG NÀY
let reconciledTicketsCurrentPage = 1; // <-- THÊM DÒNG NÀY
// Biến trạng thái toàn cục
var selectedTickets = [];
var managerSelectedItems = [];
var borrowNotes = [];
var ticketRanges = [];
var excelData = [];
var currentPage = 1;
var pageSize = 10;
var pendingReturnNotes = [];
var managerReturnItems = [];
// =======================================================
// UTILS CHUNG & API CALL WRAPPER
// =======================================================
function normalizeCode(code){ 
    return (code || '').toString().trim().toLowerCase();
}

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
    const response = await fetch(API_BASE_URL + endpoint, { 
        method: 'POST', 
        headers, 
        body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok || result.error) 
        throw new Error(result.error || 'Lỗi server.');
    
    // 🔹 Trả về đúng kiểu dữ liệu dù backend có hoặc không bọc trong {data: ...}
    return (result && result.data !== undefined) ? result.data : result;
}




// --- HÀM XỬ LÝ AUTH THÀNH CÔNG (MỚI) ---
// File: app.js

// File: app.js

// File: app.js
// THAY THẾ TOÀN BỘ HÀM handleAuthSuccess

async function handleAuthSuccess(user) {
    // Lấy các element
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    const infoSpinner = document.getElementById('infoSpinner');
    const mainPage = document.getElementById('mainPage');
    const managerPage = document.getElementById('managerPage');
    const auditorPage = document.getElementById('auditorPage');

    // 1. Chỉ ẩn nút Auth, hiện nút Sign Out.
    //    GIỮ NGUYÊN SPINNER (KHÔNG ẨN)
    if (authButton) authButton.style.display = 'none';
    if (signOutButton) signOutButton.style.display = 'inline-block';
    
    // Đảm bảo spinner "Đang tải..." của Thông tin chung được BẬT
    if (infoSpinner) infoSpinner.style.display = 'block'; 

    // Ẩn hết các trang chính (để tránh bị nháy trang KTV)
    if (mainPage) mainPage.style.display = 'none';
    if (managerPage) managerPage.style.display = 'none';
    if (auditorPage) auditorPage.style.display = 'none';

    userEmail = user.email;
    technicianName = user.displayName;

    try {
        // 2. CHỜ KIỂM TRA VAI TRÒ (Đây là lúc delay 1.5s)
        //    Spinner "Đang tải..." vẫn đang hiển thị, người dùng sẽ không thấy trang trắng
        const roles = await callAuthApi('/auth/checkRoles', { email: userEmail, name: technicianName });
        isManager = roles.isManager || false;
        isAuditor = roles.isAuditor || false;

        console.log(`Roles: isManager=${isManager}, isAuditor=${isAuditor}`);

        // 3. SAU KHI CÓ KẾT QUẢ, ẨN SPINNER
        if (infoSpinner) infoSpinner.style.display = 'none'; 

        // 4. HIỂN THỊ TRANG CHÍNH XÁC (Giữ nguyên logic if/else)
        if (isAuditor) {
            console.log("Hiển thị trang Auditor.");
            if (auditorPage) auditorPage.style.display = 'block';
            if (!techniciansLoaded) loadTechnicians();
            listenForAuditorHistory();

        } else if (isManager) {
            console.log("Hiển thị trang KTV (là Manager).");
            if (mainPage) mainPage.style.display = 'block';
            document.getElementById('userEmail').innerText = userEmail;
            document.getElementById('technicianName').innerText = technicianName;
            if (document.getElementById('managerPageButton')) {
                document.getElementById('managerPageButton').style.display = 'inline-block';
            }
            loadSelfDashboard();
            listenForKtvHistory();
            if (!techniciansLoaded) loadTechnicians();
            initItemSearch();

        } else {
            console.log("Hiển thị trang KTV (thông thường).");
            if (mainPage) mainPage.style.display = 'block';
            document.getElementById('userEmail').innerText = userEmail;
            document.getElementById('technicianName').innerText = technicianName;
            loadSelfDashboard();
            listenForKtvHistory();
        }
    
    } catch (err) {
        // 5. NẾU LỖI, CŨNG ẨN SPINNER VÀ HIỆN TRANG KTV
        if (infoSpinner) infoSpinner.style.display = 'none'; // <-- ẨN SPINNER KHI LỖI

        console.error("Lỗi kiểm tra vai trò:", err);
        showError('infoErrorMessage', 'Lỗi kiểm tra vai trò: ' + err.message);
        
        // Hiển thị trang KTV cơ bản nếu có lỗi
        if (mainPage) mainPage.style.display = 'block';
        document.getElementById('userEmail').innerText = userEmail;
        document.getElementById('technicianName').innerText = technicianName;
        loadSelfDashboard();
        listenForKtvHistory();
    }
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


// --- HÀM GỌI API (ĐÃ SỬA) ---
async function callApi(endpoint, data) {
    console.log(`Calling API: ${endpoint}`); // Log khi bắt đầu gọi
    try {
        const user = auth.currentUser;
        let idToken = null;
        if (user) {
            try {
                idToken = await user.getIdToken(true); // Lấy token mới nhất
            } catch (tokenError) {
                console.error("Error getting ID token:", tokenError);
                showError('infoErrorMessage', 'Lỗi xác thực, vui lòng đăng nhập lại.');
                // Cân nhắc: Có thể signOut ở đây nếu token lỗi nghiêm trọng
                // firebase.auth().signOut();
                throw new Error('Không thể lấy token xác thực.'); // Ném lỗi để dừng
            }
        } else {
             // Nếu không có user VÀ endpoint không phải là public => Lỗi
             if (!['/auth/verifyAndRegister', '/announcement/current'].includes(endpoint)) { // Thêm các endpoint public vào đây nếu có
                  console.warn(`User not logged in for protected endpoint: ${endpoint}`);
                  showError('infoErrorMessage', 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.');
                  firebase.auth().signOut(); // Đăng xuất luôn
                  throw new Error('Yêu cầu xác thực.');
             }
             // Cho phép gọi API public nếu không có user
        }


        const headers = {
            'Content-Type': 'application/json',
        };
        if (idToken) {
            headers['Authorization'] = 'Bearer ' + idToken;
        }

        const res = await fetch(API_BASE_URL + endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        console.log(`API Response Status for ${endpoint}: ${res.status}`); // Log status code

        // Lấy text response để kiểm tra
        const text = await res.text();
        console.log(`API Response Text for ${endpoint}:`, text); // Log text thô

        if (!res.ok) {
            // Ném lỗi với nội dung text nếu có, hoặc status text
            throw new Error(text || `Lỗi HTTP! Status: ${res.status}`);
        }

        // Xử lý response thành công (2xx)
        if (!text) {
            // Nếu body rỗng dù status OK -> trả về object rỗng mặc định
            console.warn(`Empty success response received for endpoint: ${endpoint}`);
            return {}; // Trả về object rỗng thay vì undefined
        }

        try {
            // Parse JSON từ text đã lấy
            const jsonData = JSON.parse(text);
            console.log(`API Parsed JSON for ${endpoint}:`, jsonData); // Log JSON đã parse
            return jsonData;
        } catch (e) {
            // Nếu parse lỗi -> báo lỗi JSON không hợp lệ
            console.error(`Failed to parse JSON for endpoint ${endpoint}:`, text, e);
            throw new Error('Dữ liệu trả về từ server không hợp lệ.');
        }

    } catch (error) {
         console.error(`API Call failed for ${endpoint}:`, error);
         // Ném lại lỗi để các hàm gọi .catch() có thể xử lý
         throw error;
    }
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

    // document.getElementById('historyDate').addEventListener('change', function(){ currentPage=1; loadBorrowHistory(); });

    if (localStorage.getItem('darkMode')==='true') document.body.classList.add('dark-mode');
}

function attachAuthListener(authButton) {
    // Hàm này chứa logic onAuthStateChanged
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

            // Hủy listener của KTV (nếu có) khi đăng xuất
            if (ktvHistoryListener) {
                ktvHistoryListener();
                ktvHistoryListener = null;
                console.log("Đã hủy KTV history listener.");
            }
            
            // Hủy listener của Quản lý (nếu có) khi đăng xuất
            if (managerHistoryListener) {
                managerHistoryListener();
                managerHistoryListener = null;
                console.log("Đã hủy Manager history listener.");
            }
            // Hủy listener Auditor (THÊM DÒNG NÀY)
            if (auditorHistoryListener) {
                auditorHistoryListener();
                auditorHistoryListener = null;
                console.log("Đã hủy Auditor history listener.");
            }
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
    if (!techniciansLoaded) {
        loadTechnicians(); 
    }
    if (auditorHistoryListener) {
        auditorHistoryListener();
        auditorHistoryListener = null;
        console.log("Đã hủy Auditor history listener khi vào Manager.");
    }
    loadPendingNotifications(); 
    listenForManagerHistory(); // <-- ĐỔI TÊN
}
// File: app.js
function showMainPage(){
    document.getElementById('managerPage').style.display='none';
    document.getElementById('mainPage').style.display='block';

    loadSelfDashboard();

    // DÒNG GÂY LỖI ĐÃ BỊ XÓA (var type = ...)

    // Hủy listener của QUẢN LÝ
    if (managerHistoryListener) {
        managerHistoryListener();
        managerHistoryListener = null;
        console.log("Đã hủy listener lịch sử (Manager).");
    }
    // Hủy listener Auditor
    if (auditorHistoryListener) {
        auditorHistoryListener();
        auditorHistoryListener = null;
        console.log("Đã hủy Auditor history listener khi về Main.");
    }
}

// function toggleForm(){
//     var type=document.getElementById('transactionType').value;
    
//     document.getElementById('borrowSection').style.display = (type==='Mượn') ? 'block' : 'none';
//     document.getElementById('returnForm').style.display = (type==='Trả') ? 'block' : 'none';
    
//     if (type==='Mượn') {
//          loadSelfDashboard(); // Tải tổng quan
//     } else { // type === 'Trả'
//         // loadKtvReturnItems(); // Tải danh sách vật tư đang nợ
//         // (Không cần tải lịch sử trả nữa, vì bảng mới luôn hiển thị)
//     }
// }


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
    document.getElementById('managerOverviewBody').innerHTML='<tr><td colspan="7">Đang tải...</td></tr>'; // Sửa colspan

    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            borrowNotes = payload.pendingNotes || []; 
            pendingReturnNotes = payload.pendingReturnNotes || []; // Dữ liệu cho dropdown
            
            displayBorrowNotes();
            displayReturnNotes(pendingReturnNotes); // <-- GỌI HÀM CŨ
            
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

// function loadBorrowHistoryForLast5Days(){
//     document.getElementById('historySpinner').style.display='block';
//     // FIX: Đảm bảo history luôn có {history: [], totalPages: 0}
//     callApi('/history/byemail', { email: userEmail, isLast5Days: true, currentPage: currentPage, pageSize: pageSize })
//         .then(history => { 
//             displayBorrowHistory(history.history); 
//         })
//         .catch(err => { 
//             showError('historyErrorMessage','Lỗi tải lịch sử: '+err.message); 
//             // Nếu lỗi, vẫn phải tắt spinner để không bị treo
//             displayBorrowHistory([]); 
//         })
//         .finally(() => { 
//             document.getElementById('historySpinner').style.display='none'; 
//         });
// }

// function loadBorrowHistory(){
//     var dateInput=document.getElementById('historyDate').value;
//     if (!dateInput){ loadBorrowHistoryForLast5Days(); return; }
    
//     var p=dateInput.split('-');
//     var date=p[2]+'/'+p[1]+'/'+p[0]; // DD/MM/YYYY
    
//     document.getElementById('historySpinner').style.display='block';
//     callApi('/history/byemail', { email: userEmail, date: date, currentPage: currentPage, pageSize: pageSize })
//         .then(history => { displayBorrowHistory(history.history); })
//         .catch(err => { showError('historyErrorMessage','Lỗi tải lịch sử: '+err.message); })
//         .finally(() => { document.getElementById('historySpinner').style.display='none'; });
// }

// function loadMoreHistory(){ currentPage++; var d=document.getElementById('historyDate').value; if (d) loadBorrowHistory(); else loadBorrowHistoryForLast5Days(); }

// File Code.gs: Sửa lỗi hiển thị lịch sử bị tách dòng
// function displayBorrowHistory(history){
//     var tbody=document.getElementById('borrowHistoryBody');
//     // Don't clear immediately if loading more
//     // tbody.innerHTML=''; // <-- REMOVED

//     if (currentPage === 1) { // Clear only if it's the first page
//         tbody.innerHTML = '';
//     }

//     if (!history||!history.length){
//         if (currentPage === 1) { // Show message only if first page is empty
//              tbody.innerHTML='<tr><td colspan="2">Không có lịch sử mượn hàng</td></tr>';
//         }
//         document.querySelector('#borrowHistoryForm button').style.display = 'none'; // Hide "Load More" if no results
//         return;
//     }

//     history.forEach(function(entry){
//       var note = entry.note || '';
//       var itemsHtml = '';
//       var hasItems = Object.keys(entry.itemsEntered).length > 0;

//       // 1. Tạo danh sách vật tư (nếu có) - Bỏ mã vật tư
//       if (hasItems) {
//           itemsHtml = Object.values(entry.itemsEntered).map(function(it){
//               return '— '+it.name+': '+it.quantity; // No item code here
//           }).join('<br>');
//       }

//       // 2. Tạo HTML trạng thái (MỚI)
//       var statusHtml = '';
//       if (entry.status === 'Pending') {
//           statusHtml = ' <span style="color: green; font-style: italic;">(Đang xử lý...)</span>'; // <-- ĐÃ SỬA
//       } else if (entry.status === 'Rejected') {
//           var reason = entry.reason ? (': ' + entry.reason) : '';
//           statusHtml = ' <span style="color: red; font-style: italic;">(Bị từ chối' + reason + ')</span>'; // <-- ĐÃ SỬA
//       }
//       // Implicitly, 'Fulfilled' status has no specific text unless items are present

//       // 3. Kết hợp note, trạng thái, và vật tư
//       var finalNoteHtml = '';
//       // Thêm gạch ngang nếu bị từ chối và có note
//       var noteDisplay = (entry.status === 'Rejected' && note) ? `<s>${note}</s>` : note; 

//       if (noteDisplay && hasItems) {
//           // Note đã duyệt (có gạch ngang nếu bị từ chối) + Vật tư
//           finalNoteHtml = noteDisplay + statusHtml + '<br><strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
//       } else if (noteDisplay) {
//           // Chỉ có note (có gạch ngang nếu bị từ chối) + Trạng thái
//           finalNoteHtml = noteDisplay + statusHtml;
//       } else if (hasItems) {
//           // Chỉ có vật tư (mượn trực tiếp)
//           finalNoteHtml = '<strong style="font-weight: bold; font-style: italic;">Vật tư đã mượn:</strong><br>' + itemsHtml;
//       }

//       if (!finalNoteHtml && !statusHtml) finalNoteHtml = 'Không có dữ liệu'; // Fallback

//       var date=new Date(entry.timestamp).toLocaleString('vi-VN');
//       var tr=document.createElement('tr');
//       tr.innerHTML='<td data-label="Thời gian">'+date+'</td><td data-label="Nội dung mượn">'+finalNoteHtml+'</td>';
//       tbody.appendChild(tr);
//     });

//     // Show or hide "Load More" button based on whether there might be more pages
//     document.querySelector('#borrowHistoryForm button').style.display = history.length < 5 ? 'none' : 'block'; // Adjust '5' if pageSize changes
// }

// ===== Logic hiển thị Tổng quan (Giữ nguyên) =====


// File: app.js
// THAY THẾ TOÀN BỘ HÀM displayBorrowedItems BẰNG HÀM NÀY:

// File: app.js
// THAY THẾ TOÀN BỘ HÀM displayBorrowedItems BẰNG HÀM NÀY:

function displayBorrowedItems(items, isManagerView){
    var overviewBody = isManagerView ? document.getElementById('managerOverviewBody') : document.getElementById('overviewBody');
    var returnBody   = document.getElementById('borrowedItemsBody'); // Bảng của KTV
    var reconciledBody = document.getElementById('reconciledTicketsBody'); // Bảng KTV (Đã đối chiếu)
    
    // Xóa nội dung cũ
    overviewBody.innerHTML='';
    if (!isManagerView) {
        returnBody.innerHTML='';
        if (reconciledBody) reconciledBody.innerHTML = ''; 
    }
    
    let itemsShownInOverview = 0; 
    const tickets = {}; 
    const reconciledTickets = {}; 
    
    // --- LẶP QUA DỮ LIỆU TỔNG QUAN (Logic này giữ nguyên) ---
    items.forEach(function(item){
      var remaining = item.remaining || 0; 

      if (remaining > 0 || (item.unreconciledUsageDetails && item.unreconciledUsageDetails.length > 0)) {
          itemsShownInOverview++;
          var row=document.createElement('tr');
          let rowHtml = '';
          if (isManagerView) {
              var unreFull = (item.unreconciledUsageDetails||[]).map(function(u){ return '<span class="unreconciled">Sổ '+u.ticket+': '+u.quantity+' ('+(u.note||'-')+')</span>'; }).join('<br>') || 'Chưa có';
              rowHtml = '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                        '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
                        '<td data-label="Tổng mượn">'+item.quantity+'</td>'+
                        '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                        '<td data-label="Đã trả">'+item.totalReturned+'</td>'+ 
                        '<td data-label="Còn lại">'+remaining+'</td>'+ 
                        '<td data-label="Chi tiết số sổ">'+unreFull+'</td>';
          } else {
              rowHtml = '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
                        '<td data-label="Tổng mượn">'+item.quantity+'</td>'+
                        '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
                        '<td data-label="Đã trả">'+item.totalReturned+'</td>'+
                        '<td data-label="Còn lại">'+remaining+'</td>';
          }
          row.innerHTML = rowHtml;
          overviewBody.appendChild(row);
      }
      
      // --- Logic gom nhóm Sổ (Giữ nguyên) ---
      if (!isManagerView){
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
      }
    }); // Hết vòng lặp items.forEach

    if (itemsShownInOverview === 0) {
        const colSpan = isManagerView ? 7 : 5;
        overviewBody.innerHTML = `<tr><td colspan="${colSpan}">Không có vật tư nào đang nợ.</td></tr>`;
    }
    
    // --- RENDER 2 BẢNG SỔ (CHỈ CHO KTV) ---
    if (!isManagerView){
        
        // === SỬA BẢNG 1: SỔ CHƯA ĐỐI CHIẾU ===
        const sortedTickets = Object.values(tickets).sort((a, b) => a.ticketNumber - b.ticketNumber);
        sortedTickets.forEach(function(ticket) {
            var rr = document.createElement('tr');
            
            // TẠO HTML KẾT HỢP
            var combinedHtml = ticket.items.map(function(it) {
                // === SỬA ĐỔI Ở ĐÂY ===
                var name = (it.name || 'N/A'); // <-- Đã xóa mã code
                // === KẾT THÚC SỬA ĐỔI ===
                var qty = it.quantity;
                return name + ': <span class="item-quantity-in-card">' + qty + '</span>';
            }).join('<br>'); 
            
            // HTML MỚI (3 CỘT)
            rr.innerHTML =
                '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
                '<td data-label="Vật tư & SL">' + combinedHtml + '</td>' + 
                '<td data-label="Xác nhận"><input type="checkbox" class="ticket-checkbox" value="' + ticket.ticket + '"></td>'; 
            
            returnBody.appendChild(rr);
        });
        if (sortedTickets.length === 0) {
             returnBody.innerHTML='<tr><td colspan="3">Chưa có sổ cần đối chiếu</td></tr>';
        }

        // === SỬA BẢNG 2: SỔ ĐÃ ĐỐI CHIẾU ===
        const sortedReconciled = Object.values(reconciledTickets).sort((a, b) => b.ticketNumber - a.ticketNumber); 
        
        allReconciledTicketsCache = sortedReconciled; 
        reconciledTicketsCurrentPage = 1;
        renderReconciledTicketsTable(); // Gọi hàm render mới
    }
}


// =======================================================
// SUBMIT FORMS (THAY THẾ submitData/submitErrorReport)
// =======================================================

function submitForm(){
    submitReturnForm();
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
            // loadBorrowHistoryForLast5Days();
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
    // Đảm bảo spinner tồn tại trước khi truy cập style
    const techSpinner = document.getElementById('technicianSpinner');
    if (techSpinner) techSpinner.style.display='block';

    callApi('/manager/technicians')
        .then(techs => {
            var selManager = document.getElementById('technicianEmail');        // Manager view KTV
            var selFrom = document.getElementById('transferFromTech');       // Transfer From
            var selTo = document.getElementById('transferToTech');         // Transfer To
            var selManagerHistory = document.getElementById('managerHistoryFilterTech'); // Manager History Filter
            var selAuditorHistory = document.getElementById('auditorHistoryFilterTech'); // Auditor History Filter (MỚI)

            // Xóa các option cũ (trừ option mặc định)
            if (selManager) selManager.innerHTML='<option value="">Chọn kỹ thuật viên</option>';
            if (selFrom) selFrom.innerHTML = '<option value="">-- Chọn người chuyển --</option>';
            if (selTo) selTo.innerHTML = '<option value="">-- Chọn người nhận --</option>';
            if (selManagerHistory) selManagerHistory.innerHTML = '<option value="Tất cả">Tất cả KTV</option>';
            if (selAuditorHistory) selAuditorHistory.innerHTML = '<option value="Tất cả">Tất cả KTV</option>';

            (techs||[]).forEach(function(t, index){
                // Kiểm tra email hợp lệ trước khi thêm
                if (!t || !t.email) return;

                const name = t.name || t.email;
                const text = t.name ? `${t.name} (${t.email})` : t.email;
                technicianMap.set(t.email, name); // Lưu vào Map để dùng sau

                var o=document.createElement('option');
                o.value=t.email;
                o.text= text;

                // Thêm vào các dropdown (nếu tồn tại)
                if (selManager) selManager.appendChild(o.cloneNode(true));
                if (selFrom) selFrom.appendChild(o.cloneNode(true));
                if (selTo) selTo.appendChild(o.cloneNode(true));
                if (selManagerHistory) selManagerHistory.appendChild(o.cloneNode(true));
                if (selAuditorHistory) selAuditorHistory.appendChild(o.cloneNode(true)); // <-- THÊM DÒNG NÀY
                // === KẾT THÚC SỬA ===
            });
            techniciansLoaded = true; // Đánh dấu đã tải xong
        })
        .catch(err => {
            showError('technicianErrorMessage','Lỗi tải danh sách KTV: '+err.message);
            techniciansLoaded = false; // Đánh dấu là chưa tải được
        })
        .finally(() => {
            // Đảm bảo spinner tồn tại trước khi truy cập style
            if (techSpinner) techSpinner.style.display='none';
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
    
    // Đóng tất cả các toggle
    jQuery('#managerPage .toggle-content').slideUp();
    jQuery('#managerPage .toggle-header').removeClass('active');
    
    // Xóa bộ chọn note trả cũ
    document.getElementById('returnNoteSelect').value = '';
    document.getElementById('technicianNote').value = '';
    selectedReturnNoteItems = null;

    // Reset danh sách trả tạm (Bảng 2)
    managerReturnItems = [];
    displayManagerReturnList();

    if (!email){
        // Nếu bỏ chọn KTV, xóa hết các bảng
        document.getElementById('managerOverviewBody').innerHTML='';
        document.getElementById('unusedItemsBody').innerHTML='<tr><td colspan="5">Vui lòng chọn kỹ thuật viên</td></tr>';
        document.getElementById('ticketRangesBody').innerHTML='';
        return;
    }
    
    // Tải dashboard (Tổng quan, Lệnh chờ)
    loadManagerDashboard(email); 
    
    // === THÊM DÒNG NÀY VÀO ===
    // Tải dải số (tickets) cho KTV vừa chọn
    loadTicketRanges();
    // === KẾT THÚC THÊM ===
    
    // Kiểm tra xem tab "Trả vật tư" có đang active không
    var returnModeActive = document.getElementById('returnUnusedMode').checked;
    
    if (returnModeActive) {
        // Tải Bảng 1
        loadUnusedItems();
    }
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
    
    if (!borrowMode) {
        // Khi chuyển sang tab Trả
        loadUnusedItems();
        
        // Đảm bảo trạng thái mặc định là "Trả trực tiếp"
        document.getElementById('approveNoteControls').style.display = 'none';
        document.getElementById('directReturnControls').style.display = 'block';
        // (Vì dropdown "Chọn note" mặc định là "Bỏ chọn")
    }
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

// File: app.js
// THAY THẾ TOÀN BỘ HÀM loadUnusedItems

function loadUnusedItems(){
    var email = document.getElementById('technicianEmail').value;
    var tbody = document.getElementById('unusedItemsBody');
    if (!tbody) { /* ... */ return; }
    if (!email) {
        tbody.innerHTML = '<tr><td colspan="5">Vui lòng chọn kỹ thuật viên</td></tr>';
        return;
    }

    const spinner = document.getElementById('returnUnusedSpinner');
    if (spinner) spinner.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div> Đang tải...</td></tr>';

    // === 2 DÒNG GÂY LỖI ĐÃ BỊ XÓA TẠI ĐÂY ===
    // showError('returnUnusedErrorMessage',''); (ĐÃ XÓA)
    // showSuccess('returnUnusedSuccessMessage',''); (ĐÃ XÓA)

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
                                   min="0" max="${remainingQty}" value="0">
                        </td>
                        <td data-label="Thêm">
                            <button onclick="addManagerReturnItem('${index}', '${it.code}', '${it.name}', ${remainingQty})">+</button>
                        </td>`;
                    tbody.appendChild(tr);
                });
            }
            
            highlightKtvRequestedReturnItems();
        })
        .catch(err => {
            // Chỉ hiển thị lỗi nếu tải thất bại
            showError('returnUnusedErrorMessage','Lỗi tải danh sách trả: '+ (err.message || 'Lỗi không xác định'));
            tbody.innerHTML='<tr><td colspan="5">Lỗi tải danh sách vật tư.</td></tr>';
        })
        .finally(() => {
            if (spinner) spinner.style.display = 'none';
        });
}

/**
 * [SỬA ĐỔI] Gửi duyệt note KTV gửi (Quy trình cũ)
 */
function approveReturnNote(){
    var email=document.getElementById('technicianEmail').value;
    var date=document.getElementById('returnUnusedTransactionDate').value;
    var items=[];
    var valid=true;
    // Lấy danh sách input từ Bảng 1 (unusedItemsTable)
    var inputs=document.querySelectorAll('#unusedItemsTable .quantity-return-input');
    
    var selectedTs = document.getElementById('returnNoteSelect').value;
    if (!selectedTs) {
         showError('returnUnusedErrorMessage','Vui lòng chọn một note KTV để duyệt.');
         return;
    }

    // Lặp qua Bảng 1, chỉ lấy các vật tư có số lượng > 0 (đã được auto-fill)
    inputs.forEach(function(input){
      var qRet=parseFloat(input.value)||0;
      if (qRet > 0) { 
          var tr=input.closest('tr');
          var code=tr.cells[1].innerText;
          var name=tr.cells[0].innerText;
          var max=parseFloat(input.max)||0;
          
          if (qRet<0 || qRet>max){ showError('returnUnusedErrorMessage','Số lượng trả không hợp lệ cho '+code); valid=false; return; }
          
          items.push({ 
              code:code, 
              name:name, 
              quantityReturned:qRet // Dùng key này
          });
      }
    });
    
    if (!valid || !email || !date || !items.length){ showError('returnUnusedErrorMessage','Vui lòng chọn KTV, ngày và ít nhất một vật tư hợp lệ (đã được điền tự động).');
    return; }

    var data={ 
        timestamp: new Date().toISOString(), // Timestamp của QL
        type:'Trả', 
        email:email, 
        date:date, 
        items:items, 
        note: (document.getElementById('technicianReturnNote').value || '').trim(), // Note gốc KTV
        returnTimestamp: selectedTs // Đây là ID của note KTV (pendingNoteId)
    };
    
    document.getElementById('returnUnusedSpinner').style.display='block';
    
    callApi('/submit/return', data)
      .then(() => {
        showSuccess('returnUnusedSuccessMessage','Duyệt note trả thành công!');
        document.getElementById('returnUnusedTransactionDate').value='';
        document.getElementById('returnNoteSelect').value = ''; 
        document.getElementById('technicianReturnNote').value = ''; 
        selectedReturnNoteItems = null; // Reset
        
        loadUnusedItems(); // Tải lại Bảng 1
        loadManagerDashboard(email); // Tải lại dashboard
      })
      .catch(err => {
        showError('returnUnusedErrorMessage','Lỗi duyệt note: '+err.message);
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
// function submitReturnNote(){
//     var note=(document.getElementById('returnNoteItems').value||'').trim();
//     if (!note){ showError('returnNoteErrorMessage','Vui lòng nhập nội dung trả.'); return; }
    
//     var data={
//       timestamp: new Date().toISOString(),
//       type:'Trả', 
//       email:userEmail, 
//       date: new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
//       note:note,
//       items: [] 
//     };
    
//     document.getElementById('returnNoteSpinner').style.display='block';
    
//     callApi('/submit/return', data)
//         .then(() => {
//             showSuccess('returnNoteSuccessMessage','Gửi yêu cầu trả thành công!');
            
//             // === BẮT ĐẦU CẬP NHẬT GIAO DIỆN TỨC THỜI ===
//             var tbody = document.getElementById('returnHistoryBody');
            
//             // Xóa dòng "Không có lịch sử" nếu có
//             var firstRow = tbody.rows[0];
//             if (firstRow && (firstRow.cells.length === 1 || (firstRow.cells[1] && firstRow.cells[1].innerText === 'Không có lịch sử trả hàng'))) {
//                 tbody.innerHTML = '';
//             }

//             var tr = document.createElement('tr');
//             var date = new Date().toLocaleString('vi-VN');
//             // Thêm trạng thái MÀU XANH
//             var statusHtml = ' <span style="color: blue; font-weight: bold; font-style: italic">(Đang xử lý...)</span>';
            
//             tr.innerHTML = '<td data-label="Thời gian">' + date + '</td>' +
//                            '<td data-label="Nội dung trả">' + note + statusHtml + '</td>';
            
//             tbody.prepend(tr); // Thêm vào đầu bảng
//             // === KẾT THÚC CẬP NHẬT GIAO DIỆN ===
            
//             document.getElementById('returnNoteItems').value='';
//         })
//         .catch(err => {
//             showError('returnNoteErrorMessage','Lỗi gửi yêu cầu: '+err.message);
//         })
//         .finally(() => {
//             document.getElementById('returnNoteSpinner').style.display='none';
//         });
// }

/**
 * Hiển thị danh sách các note trả hàng đang chờ
 */
function loadKtvReturnItems() {
    const tbody = document.getElementById('ktvReturnItemsBody');
    if (!tbody) {
        console.warn("Attempted to load return items but tbody not found.");
        return;
    }
    const spinner = document.getElementById('ktvReturnSpinner');
    if (spinner) spinner.style.display = 'block';
    // Update colspan
    tbody.innerHTML = '<tr><td colspan="3"><div class="spinner"></div> Đang tải...</td></tr>';

    callApi('/dashboard', { technicianEmail: userEmail })
        .then(payload => {
            const items = payload.items || [];
            const returnableItems = items.filter(it => it.remaining > 0);
            tbody.innerHTML = '';

            if (returnableItems.length === 0) {
                // Update colspan
                tbody.innerHTML = '<tr><td colspan="3">Bạn không nợ vật tư nào để trả.</td></tr>';
                const submitBtn = document.getElementById('submitKtvReturnButton');
                if (submitBtn) submitBtn.style.display = 'none';
                return;
            }

            const submitBtn = document.getElementById('submitKtvReturnButton');
            if (submitBtn) submitBtn.style.display = 'inline-block';

            returnableItems.forEach(item => {
                var tr = document.createElement('tr');
                // REMOVE the item code cell (<td> for item.code)
                tr.innerHTML = `
                    <td data-label="Tên vật tư">${item.name}</td>
                    <td data-label="Đang nợ" style="text-align: center;">${item.remaining}</td>
                    <td data-label="Số lượng trả">
                        <input type="number" class="ktv-return-input"
                               min="0" max="${item.remaining}" value="0"
                               data-code="${item.code}" data-name="${item.name}"
                               style="width: 80px; max-width: 100px; padding: 8px; text-align: center;">
                    </td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            showError('ktvReturnErrorMessage', 'Lỗi tải danh sách vật tư nợ: ' + err.message);
            // Update colspan
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

    // Clear previous messages
    showError('ktvReturnErrorMessage', '');
    showSuccess('ktvReturnSuccessMessage', '');


    inputs.forEach(input => {
        // Skip if already found an error
        if(hasError) return;

        const qty = parseInt(input.value, 10) || 0;
        const max = parseInt(input.max, 10);
        const code = input.dataset.code;
        const name = input.dataset.name; // Get name for the request

        if (qty < 0 || qty > max) {
            showError('ktvReturnErrorMessage', `Số lượng trả cho ${name || code} không hợp lệ (phải từ 0 đến ${max}).`);
            input.focus(); // Focus the invalid input
            hasError = true;
            return;
        }

        if (qty > 0) {
            itemsToReturn.push({
                code: code,
                name: name, // Include name
                quantityReturned: qty // Key used by backend logic
            });
        }
    });

    if (hasError) return;
    if (itemsToReturn.length === 0) {
        showError('ktvReturnErrorMessage', 'Vui lòng nhập số lượng cho ít nhất 1 vật tư để trả.');
        return;
    }

    const note = (document.getElementById('ktvReturnNote').value || '').trim();

    const data = {
        timestamp: new Date().toISOString(),
        type: 'Trả',
        email: userEmail,
        date: new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}),
        note: note || 'KTV trả vật tư không sử dụng', // Default note
        items: itemsToReturn // This becomes itemsR in backend
    };

    if (spinner) spinner.style.display = 'block';

    callApi('/submit/return', data)
        .then(() => {
            showSuccess('ktvReturnSuccessMessage', 'Gửi yêu cầu trả thành công! Chờ quản lý duyệt.');
            document.getElementById('ktvReturnNote').value = ''; // Clear note field
            // Don't reload immediately, let the listener update history
            // loadReturnHistory();
            // Reload the return items list to show updated remaining quantities (or empty state)
            loadKtvReturnItems();
            // Reload the overview dashboard as well
            loadSelfDashboard();
        })
        .catch(err => {
            showError('ktvReturnErrorMessage', 'Lỗi gửi yêu cầu trả: ' + err.message);
        })
        .finally(() => {
            if (spinner) spinner.style.display = 'none';
        });
}
function displayReturnNotes(notes){
    var select=document.getElementById('returnNoteSelect');
    select.innerHTML='<option value="">-- Bỏ chọn (Để Trả hàng Trực tiếp) --</option>'; // Sửa text
    
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
 * [SỬA ĐỔI] Hiển thị nội dung note trả khi Quản lý chọn
 */
function displaySelectedReturnNote(){
    var ts = document.getElementById('returnNoteSelect').value;
    
    var approveControls = document.getElementById('approveNoteControls');
    var directControls = document.getElementById('directReturnControls');
    
    // === THÊM 2 DÒNG RESET VÀO ĐÂY ===
    // Khi chọn/bỏ chọn note, reset danh sách trả tạm (Bảng 2)
    managerReturnItems = [];
    displayManagerReturnList();
    // === KẾT THÚC THÊM ===
    
    if (!ts) {
        // Nếu Quản lý "Bỏ chọn" (Trả trực tiếp)
        document.getElementById('technicianReturnNote').value = '';
        selectedReturnNoteItems = null;
        
        approveControls.style.display = 'none'; 
        directControls.style.display = 'block'; 
        
        loadUnusedItems(); // Tải lại bảng (sẽ xóa highlight)
        return;
    }
    
    // Nếu Quản lý CHỌN một note
    var n = (pendingReturnNotes || []).find(function(x){ return x.timestamp === ts; });
    document.getElementById('technicianReturnNote').value = n ? n.note : '';
    selectedReturnNoteItems = n ? (n.items || []) : null; 
    
    approveControls.style.display = 'block'; 
    directControls.style.display = 'none'; 
    
    loadUnusedItems();
}
// File: app.js (DÁN VÀO CUỐI FILE)

/**
 * [SỬA ĐỔI] Từ chối note KTV gửi (Quy trình cũ)
 */
function rejectReturnNote() {
    var selectedTs = document.getElementById('returnNoteSelect').value;
    var reason = (document.getElementById('returnRejectionReason').value || '').trim();
    var email = document.getElementById('technicianEmail').value;

    if (!selectedTs) { /* ... (báo lỗi) ... */ return; }
    if (!reason) { /* ... (báo lỗi) ... */ return; }

    var data = { email: email, timestamp: selectedTs, reason: reason };
    document.getElementById('returnUnusedSpinner').style.display = 'block';

    callApi('/manager/rejectReturnNote', data)
        .then(() => {
            showSuccess('returnUnusedSuccessMessage', 'Đã từ chối note thành công!');
            document.getElementById('returnRejectionReason').value = '';
            document.getElementById('returnNoteSelect').value = '';
            document.getElementById('technicianNote').value = '';
            selectedReturnNoteItems = null; // Reset
            
            loadUnusedItems(); // Tải lại Bảng 1
            loadManagerDashboard(email); // Tải lại dashboard
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
// function loadReturnHistory(){
//     document.getElementById('returnHistorySpinner').style.display='block';
    
//     // Gọi API mới
//     callApi('/history/return', { email: userEmail, currentPage: 1, pageSize: 50 }) // Tạm thời tải 50
//         .then(history => { 
//             displayReturnHistory(history.history); 
//         })
//         .catch(err => { 
//             document.getElementById('returnHistoryBody').innerHTML = '<tr><td colspan="2">Lỗi tải lịch sử.</td></tr>';
//         })
//         .finally(() => { 
//             document.getElementById('returnHistorySpinner').style.display='none'; 
//         });
// }

/**
 * Hiển thị lịch sử TRẢ hàng (Tương tự displayBorrowHistory)
 */
// function displayReturnHistory(history){
//     var tbody=document.getElementById('returnHistoryBody');
//     tbody.innerHTML='';

//     if (!history||!history.length){ tbody.innerHTML='<tr><td colspan="2">Không có lịch sử trả hàng</td></tr>'; return; }
    
//     history.forEach(function(entry){
//       var note = entry.note || '';
//       var itemsHtml = '';
//       var hasItems = Object.keys(entry.itemsEntered).length > 0;

//       // 1. Tạo danh sách vật tư (nếu có)
//       if (hasItems) {
//           itemsHtml = Object.values(entry.itemsEntered).map(function(it){ 
//               return '— '+it.name+' ('+it.code+'): '+it.quantity; 
//           }).join('<br>');
//       }

//       // 2. Tạo HTML trạng thái (MÀU XANH/ĐỎ)
//       var statusHtml = '';
//       if (entry.status === 'Pending') {
//           statusHtml = ' <span style="color: green; font-style: italic;">(Đang xử lý...)</span>'; // <-- ĐÃ SỬA
//       } else if (entry.status === 'Rejected') {
//           // Thêm lý do từ chối (nếu có)
//           var reason = entry.reason ? (': ' + entry.reason) : '';
//           statusHtml = ' <span style="color: red; font-style: italic;">(Bị từ chối' + reason + ')</span>'; // <-- ĐÃ SỬA
//       }

//       // 3. Kết hợp note, trạng thái, và vật tư
//       var finalNoteHtml = '';
//       // Thêm gạch ngang nếu bị từ chối và có note
//       var noteDisplay = (entry.status === 'Rejected' && note) ? `<s>${note}</s>` : note; 

//       if (noteDisplay && hasItems) {
//           // Note đã duyệt (có gạch ngang nếu bị từ chối) + Vật tư
//           finalNoteHtml = noteDisplay + statusHtml + '<br><strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
//       } else if (noteDisplay) {
//           // Chỉ có note (có gạch ngang nếu bị từ chối) + Trạng thái
//           finalNoteHtml = noteDisplay + statusHtml;
//       } else if (hasItems) {
//           // Chỉ có vật tư (đã duyệt, không có note gốc)
//           finalNoteHtml = '<strong style="font-weight: bold; font-style: italic;">Vật tư đã duyệt:</strong><br>' + itemsHtml;
//       }

//       if (!finalNoteHtml) finalNoteHtml = 'Không có dữ liệu';
    
//       var date=new Date(entry.timestamp).toLocaleString('vi-VN');
//       var tr=document.createElement('tr');
//       tr.innerHTML='<td data-label="Thời gian">'+date+'</td><td data-label="Nội dung trả">'+finalNoteHtml+'</td>'; 
//       tbody.appendChild(tr);
//     });
// }
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
// File: app.js
// THAY THẾ TOÀN BỘ HÀM NÀY:

/**
 * Tải danh sách vật tư KTV đang nợ để chuyển (ĐÃ SỬA LỖI)
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

            // SỬA 1: Lọc theo "remaining" (còn lại) thay vì "quantity" (tổng mượn)
            const transferableItems = items.filter(it => it.remaining > 0);

            if (transferableItems.length === 0) {
                 tbody.innerHTML = '<tr><td colspan="4">Kỹ thuật viên này không nợ vật tư nào.</td></tr>';
                 return;
            }

            transferableItems.forEach(item => {
                const row = document.createElement('tr');
                
                // SỬA 2 & 3: Hiển thị và đặt max là "remaining"
                row.innerHTML = `
                    <td data-label="Tên vật tư">${item.name || ''}</td>
                    <td data-label="Mã vật tư">${item.code || ''}</td>
                    <td data-label="Đang nợ" style="text-align: center;">${item.remaining}</td>
                    <td data-label="Số lượng chuyển">
                        <input type="number" class="transfer-quantity-input" min="0" max="${item.remaining}" value="0" data-code="${item.code}" data-name="${item.name}">
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
// File: app.js
// DÁN 3 HÀM NÀY VÀO CUỐI FILE

/**
 * Định dạng nội dung cho bảng lịch sử (helper)
 */
function formatManagerHistoryContent(doc) {
    let html = '';
    let statusHtml = '';

    // === SỬA LỖI LOGIC HIỂN THỊ TÊN ===
    // 1. Thêm KTV (Ưu tiên Tên, nếu không có Tên thì mới dùng Email)
    let techDisplay = doc.email; // Mặc định là email
    
    if (technicianMap.has(doc.email)) {
        const name = technicianMap.get(doc.email);
        // Chỉ dùng Tên nếu Tên tồn tại và không phải là chuỗi rỗng
        if (name && name.trim() !== '') {
            techDisplay = name; // <-- CHỈ HIỂN THỊ TÊN
        }
        // (Nếu không, techDisplay vẫn là doc.email, là đúng)
    } else if (techniciansLoaded) {
         // Nếu đã tải xong KTV mà vẫn không thấy -> có thể là KTV cũ
         techDisplay = `${doc.email} (cũ)`;
    }
    // (Nếu chưa tải xong KTV, techDisplay vẫn là email)
    
    html += `<strong>KTV:</strong> ${techDisplay}<br>`;
    // === KẾT THÚC SỬA LỖI ===

    // 2. Tạo HTML Trạng thái
    if (doc.status === 'Pending') {
        statusHtml = `<span style="color: blue; font-style: italic;">(Đang chờ duyệt...)</span><br>`;
    } else if (doc.status === 'Rejected') {
        let reason = doc.rejectionReason ? `: ${doc.rejectionReason}` : '';
        statusHtml = `<span style="color: red; font-style: italic;">(Bị từ chối${reason})</span><br>`;
    }

    // 3. Thêm Nội dung mượn (Note)
    let noteDisplay = (doc.status === 'Rejected' && doc.note) ? `<s>${doc.note}</s>` : doc.note;
    if (noteDisplay) {
        html += `<strong>Nội dung:</strong> ${noteDisplay}<br>`; // Đã đổi thành "Nội dung"
    }

    // 4. Thêm Trạng thái
    html += statusHtml;

    // 5. Thêm Vật tư
    if (doc.items && doc.items.length > 0) {
        html += `<strong>Vật tư đã duyệt:</strong><ul>`;
        doc.items.forEach(item => {
            html += `<li>${item.name || item.code}: ${item.quantity}</li>`;
        });
        html += `</ul>`;
    }
    return html;
}

/**
 * Vẽ lại bảng lịch sử từ cache (khi lọc)
 */
function renderManagerHistoryTable() {
    // SỬA 1: Dùng đúng ID của tbody
    const tbody = document.getElementById('managerHistoryBody'); 
    if (!tbody) {
        console.error("Lỗi render: Không tìm thấy 'managerHistoryBody'");
        return; 
    }
    
    // SỬA 2 & 3: Dùng đúng ID của bộ lọc
    const filterValue = document.getElementById('managerHistoryFilterType').value;
    const filterTech = document.getElementById('managerHistoryFilterTech').value; 
    
    tbody.innerHTML = ''; // Xóa nội dung cũ
    
    // SỬA 4: Dùng đúng biến cache
    const filteredDocs = managerHistoryCache.filter(doc => { 
        const typeMatch = (filterValue === 'Tất cả' || doc.type === filterValue);
        const techMatch = (filterTech === 'Tất cả' || doc.email === filterTech); 
        return typeMatch && techMatch;
    });

    if (filteredDocs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Không có dữ liệu khớp với bộ lọc.</td></tr>';
        return;
    }
    
    filteredDocs.forEach(doc => {
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'unreconciled' : 'success'; 
        
        // Gọi đúng hàm format (formatManagerHistoryContent)
        tr.innerHTML = `
            <td data-label="Thời gian">${timestamp}</td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatManagerHistoryContent(doc)}</td> 
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Lắng nghe thay đổi trên collection history_transactions
 */
/**
 * [MANAGER] Lắng nghe thay đổi trên collection history_transactions
 */
/**
 * [MANAGER] Lắng nghe thay đổi trên collection history_transactions
 */
/**
 * [MANAGER] Lắng nghe thay đổi trên collection history_transactions (Trang 1)
 */
function listenForManagerHistory() {
    if (managerHistoryListener) {
        managerHistoryListener();
        managerHistoryListener = null;
    }

    const spinner = document.getElementById('managerHistorySpinner');
    if (!spinner) { /* ... (báo lỗi) ... */ return; }
    spinner.style.display = 'block';
    
    // Ẩn và kích hoạt nút Tải thêm
    const loadMoreBtn = document.getElementById('loadMoreManagerHistory');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerText = 'Tải thêm';
    }

    const historyQuery = firebase.firestore().collection('history_transactions')
                                    .orderBy('timestamp', 'desc')
                                    .limit(HISTORY_PAGE_SIZE);

    managerHistoryListener = historyQuery.onSnapshot(snapshot => {
        // (Xóa log console.log cũ)
        if (spinner) spinner.style.display = 'none'; 
        managerHistoryCache = []; // Xóa cache cũ khi có cập nhật
        
        snapshot.forEach(doc => {
            managerHistoryCache.push(doc.data());
        });
        
        managerHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Lưu lại document cuối cùng của trang 1
        const snapshotSize = snapshot.size;
        managerHistoryLastDoc = snapshotSize > 0 ? snapshot.docs[snapshotSize - 1] : null;

        // Hiển thị nút Tải thêm
        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }

        renderManagerHistoryTable(); 
    }, error => {
        // ... (khối xử lý lỗi giữ nguyên) ...
        console.error("Lỗi Manager Real-time History:", error);
        if (spinner) spinner.style.display = 'none';
        const historyBody = document.getElementById('managerHistoryBody');
        if (historyBody) { /* ... (hiển thị lỗi) ... */ }
        if (managerHistoryListener) { /* ... (hủy listener) ... */ }
    });

    console.log("Đã bật listener lịch sử (Manager) cho Trang 1.");
}
// File: app.js
// DÁN 3 HÀM MỚI NÀY VÀO CUỐI FILE

/**
 * [KTV] Định dạng nội dung (Đã rút gọn)
 */
function formatKtvHistoryContent(doc) {
    let html = '';
    let statusHtml = '';

    // Tạo HTML Trạng thái
    if (doc.status === 'Pending') {
        statusHtml = `<span style="color: blue; font-style: italic;">(Đang chờ duyệt...)</span><br>`;
    } else if (doc.status === 'Rejected') {
        let reason = doc.rejectionReason ? `: ${doc.rejectionReason}` : '';
        statusHtml = `<span style="color: red; font-style: italic;">(Bị từ chối${reason})</span><br>`;
    }

    // Thêm Nội dung mượn (Note)
    let noteDisplay = (doc.status === 'Rejected' && doc.note) ? `<s>${doc.note}</s>` : doc.note;
    if (noteDisplay) {
        html += `<strong>Nội dung:</strong> ${noteDisplay}<br>`;
    }

    // Thêm Trạng thái
    html += statusHtml;

    // Thêm Vật tư
    if (doc.items && doc.items.length > 0) {
        html += `<strong>Vật tư đã duyệt:</strong><ul>`;
        doc.items.forEach(item => {
            html += `<li>${item.name || item.code}: ${item.quantity}</li>`;
        });
        html += `</ul>`;
    }

    if (!html.trim()) html = '...';
    return html;
}

/**
 * [KTV] Vẽ lại bảng lịch sử từ cache (khi lọc)
 */
function renderKtvHistoryTable() {
    const tbody = document.getElementById('ktvHistoryBody');
    if (!tbody) return; 
    
    const filterValue = document.getElementById('ktvHistoryFilterType').value;
    tbody.innerHTML = '';
    
    const filteredDocs = ktvHistoryCache.filter(doc => {
        if (filterValue === 'Tất cả') return true;
        return doc.type === filterValue;
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
            <td data-label="Nội dung">${formatKtvHistoryContent(doc)}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * [KTV] Lắng nghe lịch sử của CHÍNH KTV
 */
/**
 * [KTV] Lắng nghe lịch sử của CHÍNH KTV (Trang 1)
 */
function listenForKtvHistory() {
    // Hủy listener cũ (nếu có) để tránh chạy nhiều lần
    if (ktvHistoryListener) {
        ktvHistoryListener();
        ktvHistoryListener = null;
    }

    const spinner = document.getElementById('ktvHistorySpinner');
    spinner.style.display = 'block';
    
    // Ẩn và kích hoạt nút Tải thêm
    const loadMoreBtn = document.getElementById('loadMoreKtvHistory');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerText = 'Tải thêm';
    }

    const historyQuery = firebase.firestore().collection('history_transactions')
                                    .where('email', '==', userEmail)
                                    .orderBy('timestamp', 'desc')
                                    .limit(HISTORY_PAGE_SIZE); 

    ktvHistoryListener = historyQuery.onSnapshot(snapshot => {
        spinner.style.display = 'none';
        ktvHistoryCache = []; // Xóa cache cũ khi có cập nhật thời gian thực
        
        snapshot.forEach(doc => {
            ktvHistoryCache.push(doc.data());
        });
        
        ktvHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Lưu lại document cuối cùng của trang 1
        const snapshotSize = snapshot.size;
        ktvHistoryLastDoc = snapshotSize > 0 ? snapshot.docs[snapshotSize - 1] : null;

        // Hiển thị nút Tải thêm NẾU trang 1 đã đầy (15/15)
        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }

        renderKtvHistoryTable(); // Vẽ lại bảng
    
    }, error => {
        console.error("Lỗi KTV Real-time History:", error);
        spinner.style.display = 'none';
        document.getElementById('ktvHistoryBody').innerHTML = '<tr><td colspan="3" class="error">Lỗi tải lịch sử.</td></tr>';
        
        if (ktvHistoryListener) {
            ktvHistoryListener();
            ktvHistoryListener = null;
        }
    });
    
    console.log("Đã bật listener lịch sử (KTV) cho Trang 1.");
}
// Xử lý Slide Toggle cho các section
jQuery(document).ready(function($) {
    $('.toggle-header').on('click', function() {
        var header = $(this);
        var content = header.next('.toggle-content');
        var contentId = content.attr('id'); // Lấy ID của div nội dung

        // === THÊM LOGIC GỌI HÀM KHI MỞ ===
        // Chỉ gọi loadKtvReturnItems khi mở toggle "Trả hàng" (returnContent)
        // và header chưa có class 'active' (tức là nó đang đóng)
        if (contentId === 'returnContent' && !header.hasClass('active')) {
             console.log("Mở mục Trả hàng, đang gọi loadKtvReturnItems...");
             loadKtvReturnItems(); // Gọi hàm tải danh sách
        }
        // === KẾT THÚC THÊM LOGIC ===

        // Thực hiện slide toggle
        content.slideToggle(300); // 300ms animation

        // Đổi trạng thái active của header (để đổi mũi tên)
        header.toggleClass('active');
    });
});
/**
 * [SỬA ĐỔI] Tô sáng và tự điền số lượng KTV yêu cầu
 */
function highlightKtvRequestedReturnItems() {
    const tbody = document.getElementById('unusedItemsBody');
    if (!tbody) return; // Thoát nếu tbody chưa sẵn sàng

    // Nếu không có note nào được chọn, xóa highlight cũ
    if (!selectedReturnNoteItems || selectedReturnNoteItems.length === 0) {
         tbody.querySelectorAll('tr.requested-return').forEach(row => row.classList.remove('requested-return'));
         // Reset input về 0 (quan trọng khi bỏ chọn note)
         tbody.querySelectorAll('.quantity-return-input').forEach(input => input.value = 0);
        return;
    }

    // === SỬA LỖI Ở ĐÂY ===
    // Bỏ chữ "utils."
    const requestedMap = new Map(selectedReturnNoteItems.map(item => [normalizeCode(item.code), item.quantity]));
    // === KẾT THÚC SỬA ===

    tbody.querySelectorAll('tr').forEach(row => {
        // === SỬA LỖI Ở ĐÂY ===
        // Bỏ chữ "utils."
        const rowCode = normalizeCode(row.dataset.code); 
        // === KẾT THÚC SỬA ===
        
        const input = row.querySelector('.quantity-return-input');

        if (rowCode && input) {
            if (requestedMap.has(rowCode)) {
                const requestedQty = requestedMap.get(rowCode);
                const maxQty = parseInt(input.max, 10);
                const fillQty = Math.min(requestedQty, maxQty);
                
                input.value = fillQty;
                row.classList.add('requested-return'); // Thêm class highlight
            } else {
                row.classList.remove('requested-return');
                input.value = 0; // Reset về 0
            }
        }
    });
}
/**
 * [AUDITOR] Định dạng nội dung (Giống Manager)
 */
function formatAuditorHistoryContent(doc) {
    // Hàm này giống hệt formatManagerHistoryContent
    // Bạn có thể copy paste nội dung hoặc gọi trực tiếp hàm kia
    return formatManagerHistoryContent(doc); // Gọi lại hàm của Manager cho gọn
}

/**
 * [AUDITOR] Vẽ lại bảng lịch sử từ cache
 */
function renderAuditorHistoryTable() {
    const tbody = document.getElementById('auditorHistoryBody');
    if (!tbody) {
        console.error("Lỗi render: Không tìm thấy 'auditorHistoryBody'");
        return;
    }

    const filterValue = document.getElementById('auditorHistoryFilterType').value;
    const filterTech = document.getElementById('auditorHistoryFilterTech').value;
    tbody.innerHTML = '';

    const filteredDocs = auditorHistoryCache.filter(doc => {
        const typeMatch = (filterValue === 'Tất cả' || doc.type === filterValue);
        const techMatch = (filterTech === 'Tất cả' || doc.email === filterTech);
        return typeMatch && techMatch;
    });

    if (filteredDocs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Không có dữ liệu khớp với bộ lọc.</td></tr>';
        return;
    }

    filteredDocs.forEach(doc => {
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'unreconciled' : 'success';

        tr.innerHTML = `
            <td data-label="Thời gian">${timestamp}</td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatAuditorHistoryContent(doc)}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * [AUDITOR] Lắng nghe lịch sử của TẤT CẢ KTV
 */
function listenForAuditorHistory() {
    if (auditorHistoryListener) {
        auditorHistoryListener();
        auditorHistoryListener = null;
    }

    const spinner = document.getElementById('auditorHistorySpinner');
    if (!spinner) { /* ... (báo lỗi) ... */ return; }
    spinner.style.display = 'block';
    
    // Ẩn và kích hoạt nút Tải thêm
    const loadMoreBtn = document.getElementById('loadMoreAuditorHistory');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerText = 'Tải thêm';
    }

    const historyQuery = firebase.firestore().collection('history_transactions')
                                    .orderBy('timestamp', 'desc')
                                    .limit(HISTORY_PAGE_SIZE); 

    auditorHistoryListener = historyQuery.onSnapshot(snapshot => {
        // (Xóa log console.log cũ)
        if (spinner) spinner.style.display = 'none';
        auditorHistoryCache = []; // Xóa cache cũ khi có cập nhật
        
        snapshot.forEach(doc => {
            auditorHistoryCache.push(doc.data());
        });
        
        auditorHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Lưu lại document cuối cùng của trang 1
        const snapshotSize = snapshot.size;
        auditorHistoryLastDoc = snapshotSize > 0 ? snapshot.docs[snapshotSize - 1] : null;

        // Hiển thị nút Tải thêm
        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }

        renderAuditorHistoryTable(); // Vẽ bảng Auditor

    }, error => {
        // ... (khối xử lý lỗi giữ nguyên) ...
        console.error("!!! LỖI Auditor Real-time History:", error);
        if (spinner) spinner.style.display = 'none';
        const historyBody = document.getElementById('auditorHistoryBody');
        if (historyBody) { /* ... (hiển thị lỗi) ... */ }
        if (auditorHistoryListener) { /* ... (hủy listener) ... */ }
    });
    console.log("Đã bật listener lịch sử (Auditor) cho Trang 1.");
}
/**
 * [MỚI] Thêm vật tư vào danh sách trả tạm (Bảng 2)
 */
/**
 * [SỬA ĐỔI] Thêm vật tư vào danh sách trả tạm (Thêm Highlight & Scroll)
 */
function addManagerReturnItem(index, code, name, maxQty) {
    const input = document.getElementById(`return-qty-input-${index}`);
    if (!input) return;

    // Tự động bỏ chọn Note (nếu đang chọn)
    document.getElementById('returnNoteSelect').value = '';
    if (selectedReturnNoteItems) {
        selectedReturnNoteItems = null;
        highlightKtvRequestedReturnItems(); // Xóa highlight Bảng 1
    }

    const qty = parseInt(input.value, 10) || 0;

    if (qty <= 0) {
        showError('returnUnusedErrorMessage', `Số lượng trả cho ${name} phải lớn hơn 0.`);
        return;
    }
    if (qty > maxQty) {
        showError('returnUnusedErrorMessage', `Số lượng trả cho ${name} không thể vượt quá ${maxQty}.`);
        return;
    }

    let isExisting = false; // Cờ để biết là thêm mới hay cập nhật
    const existingItem = managerReturnItems.find(item => item.code === code);
    if (existingItem) {
        existingItem.quantityReturned = qty; 
        isExisting = true;
    } else {
        managerReturnItems.push({
            code: code,
            name: name,
            quantityReturned: qty
        });
    }

    // Hiển thị thông báo thành công (vẫn ở vị trí cũ)
    input.value = 0;
    showSuccess('returnUnusedSuccessMessage', `Đã thêm/cập nhật ${name} (SL: ${qty}).`);
    
    // Vẽ lại Bảng 2
    displayManagerReturnList();

    // === PHẦN TRỰC QUAN MỚI ===
    try {
        const tableBody = document.getElementById('managerReturnListBody');
        let rowToHighlight = null;

        if (isExisting) {
            // Nếu Cập nhật: Tìm hàng đã tồn tại (dựa vào Mã VT ở ô thứ 2)
            const rows = tableBody.querySelectorAll('tr');
            for (let row of rows) {
                if (row.cells[1] && row.cells[1].innerText === code) {
                    rowToHighlight = row;
                    break;
                }
            }
        } else {
            // Nếu Thêm mới: Lấy hàng cuối cùng
            rowToHighlight = tableBody.lastElementChild;
        }

        if (rowToHighlight) {
            // 1. Highlight:
            // Xóa animation cũ (nếu có)
            rowToHighlight.classList.remove('row-highlight'); 
            // Dòng này buộc trình duyệt "vẽ lại" (reflow)
            void rowToHighlight.offsetWidth; 
            // Thêm animation mới
            rowToHighlight.classList.add('row-highlight'); 

            // 2. Scroll:
            // Cuộn Bảng 2 (managerReturnListTable) vào tầm nhìn
            const tableElement = document.getElementById('managerReturnListTable');
            tableElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (e) {
        console.warn("Lỗi khi highlight/scroll:", e);
    }
    // === KẾT THÚC PHẦN MỚI ===
}

/**
 * [MỚI] Hiển thị danh sách trả tạm (Bảng 2)
 */
function displayManagerReturnList() {
    const tbody = document.getElementById('managerReturnListBody');
    tbody.innerHTML = '';
    
    if (managerReturnItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Danh sách trả trống.</td></tr>';
        return;
    }

    managerReturnItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Tên vật tư">${item.name}</td>
            <td data-label="Mã vật tư">${item.code}</td>
            <td data-label="Số lượng trả">${item.quantityReturned}</td>
            <td data-label="Xóa"><button onclick="removeManagerReturnItem(${index})">Xóa</button></td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * [MỚI] Xóa vật tư khỏi danh sách trả tạm
 */
function removeManagerReturnItem(index) {
    managerReturnItems.splice(index, 1);
    displayManagerReturnList();
}

/**
 * [MỚI] Gửi danh sách trả trực tiếp (Bảng 2)
 */
function submitManagerReturnList() {
    var email = document.getElementById('technicianEmail').value;
    var date = document.getElementById('returnUnusedTransactionDate').value;
    var note = (document.getElementById('managerReturnNote').value || '').trim();

    if (!email || !date) { /* ... (báo lỗi) ... */ return; }
    if (managerReturnItems.length === 0) { /* ... (báo lỗi) ... */ return; }

    var data = { 
        timestamp: new Date().toISOString(), 
        type: 'Trả', 
        email: email, 
        date: date, 
        items: managerReturnItems, 
        note: note || 'Quản lý trả vật tư không sử dụng',
        returnTimestamp: '', // Rỗng
        mode: 'MANAGER_DIRECT' // <-- CỜ QUAN TRỌNG
    };

    const spinner = document.getElementById('returnUnusedSpinner');
    if (spinner) spinner.style.display = 'block';

    callApi('/submit/return', data)
      .then(() => {
        showSuccess('returnUnusedSuccessMessage', 'Xác nhận trả vật tư (trực tiếp) thành công!');
        document.getElementById('returnUnusedTransactionDate').value = '';
        document.getElementById('managerReturnNote').value = '';
        managerReturnItems = [];
        displayManagerReturnList();
        loadUnusedItems(); // Tải lại Bảng 1
        loadManagerDashboard(email); // Tải lại dashboard
      })
      .catch(err => {
        showError('returnUnusedErrorMessage', 'Lỗi xác nhận: ' + err.message);
      })
      .finally(() => {
        if (spinner) spinner.style.display = 'none';
      });
}
/**
 * [KTV] Tải thêm trang lịch sử tiếp theo
 */
function loadMoreKtvHistory() {
    if (!ktvHistoryLastDoc) return; // Không có gì để tải
    const btn = document.getElementById('loadMoreKtvHistory');
    btn.disabled = true;
    btn.innerText = 'Đang tải...';

    // Tạo truy vấn cho trang tiếp theo
    const nextQuery = firebase.firestore().collection('history_transactions')
                                .where('email', '==', userEmail)
                                .orderBy('timestamp', 'desc')
                                .startAfter(ktvHistoryLastDoc) // <-- Bắt đầu sau doc cuối
                                .limit(HISTORY_PAGE_SIZE);
    
    // Dùng .get() (lấy 1 lần) thay vì .onSnapshot() (lắng nghe)
    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            ktvHistoryLastDoc = snapshot.docs[snapshotSize - 1]; // Cập nhật doc cuối
            snapshot.forEach(doc => {
                ktvHistoryCache.push(doc.data()); // Nối vào cache
            });
            renderKtvHistoryTable(); // Vẽ lại toàn bộ cache
        }
        
        btn.disabled = false;
        btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) {
            btn.style.display = 'none'; // Đã hết, ẩn nút
        }
    }).catch(err => {
        console.error("Lỗi tải thêm (KTV):", err);
        btn.disabled = false;
        btn.innerText = 'Lỗi! Thử lại';
    });
}

/**
 * [MANAGER] Tải thêm trang lịch sử tiếp theo
 */
function loadMoreManagerHistory() {
    if (!managerHistoryLastDoc) return;
    const btn = document.getElementById('loadMoreManagerHistory');
    btn.disabled = true;
    btn.innerText = 'Đang tải...';

    const nextQuery = firebase.firestore().collection('history_transactions')
                                .orderBy('timestamp', 'desc')
                                .startAfter(managerHistoryLastDoc)
                                .limit(HISTORY_PAGE_SIZE);
    
    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            managerHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => {
                managerHistoryCache.push(doc.data()); // Nối vào cache
            });
            renderManagerHistoryTable(); // Vẽ lại
        }
        
        btn.disabled = false;
        btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) {
            btn.style.display = 'none'; // Đã hết
        }
    }).catch(err => {
        console.error("Lỗi tải thêm (Manager):", err);
        btn.disabled = false;
        btn.innerText = 'Lỗi! Thử lại';
    });
}

/**
 * [AUDITOR] Tải thêm trang lịch sử tiếp theo
 */
function loadMoreAuditorHistory() {
    if (!auditorHistoryLastDoc) return;
    const btn = document.getElementById('loadMoreAuditorHistory');
    btn.disabled = true;
    btn.innerText = 'Đang tải...';

    const nextQuery = firebase.firestore().collection('history_transactions')
                                .orderBy('timestamp', 'desc')
                                .startAfter(auditorHistoryLastDoc)
                                .limit(HISTORY_PAGE_SIZE);
    
    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            auditorHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => {
                auditorHistoryCache.push(doc.data()); // Nối vào cache
            });
            renderAuditorHistoryTable(); // Vẽ lại
        }
        
        btn.disabled = false;
        btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) {
            btn.style.display = 'none'; // Đã hết
        }
    }).catch(err => {
        console.error("Lỗi tải thêm (Auditor):", err);
        btn.disabled = false;
        btn.innerText = 'Lỗi! Thử lại';
    });
}

/**
 * [KTV] Render bảng Sổ Đã Đối Chiếu (từ cache) - ĐÃ SỬA LỖI
 */
/**
 * [KTV] Render bảng Sổ Đã Đối Chiếu (từ cache) - ĐÃ SỬA LỖI
 */
function renderReconciledTicketsTable() {
    const tbody = document.getElementById('reconciledTicketsBody');
    const loadMoreBtn = document.getElementById('loadMoreReconciled');
    if (!tbody) {
        console.error("Lỗi render: Không tìm thấy 'reconciledTicketsBody'");
        return; 
    }
    
    tbody.innerHTML = ''; 

    const itemsToShow = allReconciledTicketsCache.slice(0, reconciledTicketsCurrentPage * HISTORY_PAGE_SIZE);

    if (itemsToShow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2">Chưa có sổ đã đối chiếu</td></tr>'; 
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        return;
    }

    itemsToShow.forEach(function(ticket) {
        var rRow = document.createElement('tr');
        
        // === SỬA ĐỔI Ở ĐÂY ===
        // TẠO HTML KẾT HỢP
        var combinedHtml = ticket.items.map(function(it) {
            // === SỬA ĐỔI Ở ĐÂY ===
            var name = (it.name || 'N/A'); // <-- Đã xóa mã code
            // === KẾT THÚC SỬA ĐỔI ===
            var qty = it.quantity;
            return name + ': <span class="item-quantity-in-card">' + qty + '</span>';
        }).join('<br>');
        
        // HTML MỚI (2 CỘT)
        rRow.innerHTML =
            '<td data-label="Số sổ">' + ticket.ticket + '</td>' +
            '<td data-label="Vật tư & SL">' + combinedHtml + '</td>'; // CỘT 2 (Kết hợp)
        // === KẾT THÚC SỬA ĐỔI ===
            
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

/**
 * [KTV] Tải thêm Sổ Đã Đối Chiếu (từ cache)
 */
function loadMoreReconciledTickets() {
    const btn = document.getElementById('loadMoreReconciled');
    btn.disabled = true;
    btn.innerText = 'Đang tải...';

    reconciledTicketsCurrentPage++; // Tăng trang
    renderReconciledTicketsTable(); // Render lại
    
    // (Không cần .get() vì chúng ta đã tải tất cả về cache)
}
// function switchKtvTab(tabName) {
//     // 1. Lấy các element cần thiết
//     const borrowContent = document.getElementById('borrowTabContent');
//     const returnContent = document.getElementById('returnTabContent');
//     const borrowButton = document.getElementById('tabButtonMượn');
//     const returnButton = document.getElementById('tabButtonTrả');

//     // 2. Ẩn/hiện nội dung Tab
//     if (tabName === 'Mượn') {
//         borrowContent.style.display = 'block';
//         returnContent.style.display = 'none';
//         borrowButton.classList.add('active');
//         returnButton.classList.remove('active');
//     } else { // tabName === 'Trả'
//         borrowContent.style.display = 'none';
//         returnContent.style.display = 'block';
//         borrowButton.classList.remove('active');
//         returnButton.classList.add('active');
//     }
// }
// DOM ready
document.addEventListener('DOMContentLoaded', function(){ initForm(); });
