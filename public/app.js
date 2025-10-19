// public/app.js (FINAL - Đã chuyển đổi hoàn toàn sang Fetch API)

const API_BASE_URL = 'https://us-central1-quan-ly-vat-tu-backend.cloudfunctions.net/app/api'; 

// DỮ LIỆU NGƯỜI DÙNG (CẦN ĐƯỢC CẬP NHẬT SAU XÁC THỰC FIREBASE AUTH)
let userEmail = 'truongphuccit@gmail.com'; 
let technicianName = 'Trương Đình Phúc';
let isManager = true; // Set true để test chức năng Quản lý

// Biến trạng thái toàn cục
var selectedTickets = [];
var managerSelectedItems = [];
var borrowNotes = [];
var ticketRanges = [];
var excelData = [];
var currentPage = 1;
var pageSize = 10;


// =======================================================
// UTILS CHUNG & API CALL WRAPPER
// =======================================================

function showSuccess(id,msg){ var e=document.getElementById(id); e.innerText=msg; e.style.display='block'; setTimeout(function(){e.style.display='none';},5000); }
function showError(id,msg){ var e=document.getElementById(id); e.innerText=msg; e.style.display='block'; setTimeout(function(){e.style.display='none';},5000); }

async function callApi(endpoint, data = {}, method = 'POST') {
    // TODO: THÊM ID TOKEN SAU KHI TRIỂN KHAI FIREBASE AUTH
    const headers = {
        'Content-Type': 'application/json',
        // 'Authorization': 'Bearer ' + await getFirebaseIdToken(), 
    };

    const response = await fetch(API_BASE_URL + endpoint, {
        method: method,
        headers: headers,
        body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok || result.error) {
        throw new Error(result.error || 'Lỗi server không xác định.');
    }
    return result.data; 
}


// =======================================================
// KHỞI TẠO VÀ CHUYỂN TRANG
// =======================================================

function initForm(){
    // TODO: LOGIC XÁC THỰC FIREBASE AUTH VÀ LOAD THÔNG TIN USER ĐẦU TIÊN
    try{
        document.getElementById('infoSpinner').style.display='block';
        
        // CẬP NHẬT THÔNG TIN USER PLACEHOLDER
        document.getElementById('userEmail').innerText=userEmail;
        document.getElementById('technicianName').innerText=technicianName||'Không xác định';
        
        // Hiển thị nút Manager nếu là Manager (Phải được thêm vào index.html)
        if (isManager && document.getElementById('managerPageButton')) document.getElementById('managerPageButton').style.display = 'inline-block';
        
        loadBorrowHistoryForLast5Days();
        document.getElementById('historyDate').addEventListener('change', function(){ currentPage=1; loadBorrowHistory(); });
        toggleForm();
        
        if (isManager){ loadTechnicians(); initItemSearch(); }
        loadSelfDashboard();
        
        if (localStorage.getItem('darkMode')==='true') document.body.classList.add('dark-mode');
        document.getElementById('infoSpinner').style.display='none';
    }catch(e){
        showError('infoErrorMessage','Lỗi khởi tạo: '+e.message);
        document.getElementById('infoSpinner').style.display='none';
    }
}

function toggleDarkMode(){ document.body.classList.toggle('dark-mode'); localStorage.setItem('darkMode',document.body.classList.contains('dark-mode')); }
function showManagerPage(){ 
    document.getElementById('mainPage').style.display='none'; 
    document.getElementById('managerPage').style.display='block'; 
    loadTechnicians(); // Tải dữ liệu Manager khi chuyển trang
}
function showMainPage(){ document.getElementById('managerPage').style.display='none'; document.getElementById('mainPage').style.display='block'; }

function toggleForm(){
    var type=document.getElementById('transactionType').value;
    document.getElementById('borrowInputForm').style.display = (type==='Mượn')?'block':'none';
    document.getElementById('borrowHistoryForm').style.display = (type==='Mượn')?'block':'none';
    document.getElementById('returnForm').style.display = (type==='Trả')?'block':'none';
    if (type==='Trả') loadBorrowedItems();
}


// =======================================================
// DASHBOARD & OVERVIEW (THAY THẾ getTechnicianDashboardData/getBorrowedItems)
// =======================================================

function loadSelfDashboard(){
    document.getElementById('overviewSpinner').style.display='block';
    document.getElementById('returnSpinner').style.display='block';

    callApi('/dashboard', { technicianEmail: userEmail })
        .then(payload => {
            displayBorrowedItems(payload.items, false);
            borrowNotes = payload.pendingNotes || [];
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
    document.getElementById('managerBorrowedItemsBody').innerHTML='<tr><td colspan="8">Đang tải...</td></tr>';
    document.getElementById('managerOverviewBody').innerHTML='<tr><td colspan="6">Đang tải...</td></tr>';

    callApi('/dashboard', { technicianEmail: email })
        .then(payload => {
            borrowNotes = payload.pendingNotes || []; 
            displayBorrowNotes();
            displayBorrowedItems(payload.items || [], true);
        })
        .catch(err => {
            showError('technicianErrorMessage', 'Lỗi tải dữ liệu: ' + err.message);
            document.getElementById('managerBorrowedItemsBody').innerHTML='<tr><td colspan="8">Lỗi tải dữ liệu</td></tr>';
            document.getElementById('managerOverviewBody').innerHTML='<tr><td colspan="6">Lỗi tải dữ liệu</td></tr>';
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
    callApi('/history/byemail', { email: userEmail, isLast5Days: true, currentPage: currentPage, pageSize: pageSize })
        .then(history => { displayBorrowHistory(history.history); })
        .catch(err => { showError('historyErrorMessage','Lỗi tải lịch sử: '+err.message); })
        .finally(() => { document.getElementById('historySpinner').style.display='none'; });
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
    tbody.innerHTML='';
    
    var pendingStatusHTML = ' <span style="color: #008000; font-weight: bold;">(Đang xử lý...)</span>'; 

    if (!history||!history.length){ tbody.innerHTML='<tr><td colspan="2">Không có lịch sử mượn</td></tr>'; return;
}
    history.forEach(function(entry){
      var note=entry.note||'';
      var hasItems = Object.keys(entry.itemsEntered).length > 0;
      
      if (entry.note && !hasItems) {
          note += pendingStatusHTML;
      }
      else if (hasItems){
        var items=Object.values(entry.itemsEntered).map(function(it){ 
          return '— '+it.name+' ('+it.code+'): '+it.quantity; 
        }).join('<br>');
   
        if (entry.note) {
            note = entry.note + '<br><strong style="font-weight: bold; font-style: italic;">Vật tư:</strong><br>' + items;
        } else {
            note = '<strong style="font-weight: bold; font-style: italic;">Vật tư:</strong><br>' + items;
        }
      }
      
      if (!note) note = 'Không có ghi chú'; 
      
      var date=new Date(entry.timestamp).toLocaleString('vi-VN');
      var tr=document.createElement('tr');
      
      // SỬ DỤNG .innerHTML CHO CỘT GHI CHÚ ĐỂ RENDER MÀU XANH
      tr.innerHTML='<td data-label="Thời gian">'+date+'</td><td data-label="Nội dung mượn">'+note+'</td>'; 
      tbody.appendChild(tr);
    });
}

// ===== Logic hiển thị Tổng quan (Giữ nguyên) =====
function displayBorrowedItems(items, isManagerView){
    var overviewBody = isManagerView ? document.getElementById('managerOverviewBody') : document.getElementById('overviewBody');
    var returnBody   = document.getElementById('borrowedItemsBody');
    var managerReturnBody = document.getElementById('managerBorrowedItemsBody');

    overviewBody.innerHTML='';
    if (!isManagerView) returnBody.innerHTML='';
    if (isManagerView) managerReturnBody.innerHTML='';
    if (!items||!items.length){
      overviewBody.innerHTML='<tr><td colspan="6">Không có vật tư đã mượn</td></tr>';
      if (!isManagerView) returnBody.innerHTML='<tr><td colspan="7">Không có vật tư đã mượn</td></tr>';
      if (isManagerView) managerReturnBody.innerHTML='<tr><td colspan="8">Không có vật tư đã mượn</td></tr>';
      return;
    }

    items.forEach(function(item){
      var unre = (item.unreconciledUsageDetails||[]).map(function(u){
        return '<span class="unreconciled">Sổ '+u.ticket+': '+u.quantity+' ('+(u.note||'-')+')</span>';
      }).join('<br>') || 'Chưa có';
      var remaining = item.quantity - item.totalUsed;

      var row=document.createElement('tr');
      row.innerHTML =
        '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
        '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
        '<td data-label="Tổng mượn chưa trả">'+item.quantity+'</td>'+
      
        '<td data-label="Tổng sử dụng">'+item.totalUsed+'</td>'+
        '<td data-label="Số lượng cần trả">'+remaining+'</td>'+
        '<td data-label="Chi tiết số sổ">'+unre+'</td>';
      overviewBody.appendChild(row);

      if (!isManagerView){
        (item.unreconciledUsageDetails||[]).forEach(function(detail){
          var rr=document.createElement('tr');
          rr.innerHTML =
            '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
       
       '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
            '<td data-label="Số lượng sử dụng">'+detail.quantity+'</td>'+
            '<td data-label="Số lượng trả"><input type="number" class="quantity-return-input" min="0" value="0"></td>'+
            '<td data-label="Số sổ">'+detail.ticket+'</td>'+
            '<td data-label="Ghi chú">'+(detail.note||'-')+'</td>'+
            '<td data-label="Xác nhận"><input type="checkbox" class="ticket-checkbox" value="'+detail.ticket+'"></td>';
        returnBody.appendChild(rr);
        });
      }

      if (isManagerView){
        (item.unreconciledUsageDetails||[]).forEach(function(detail){
          var mr=document.createElement('tr');
          mr.innerHTML =
            '<td data-label="Tên vật tư">'+(item.name||'')+'</td>'+
            '<td data-label="Mã vật tư">'+(item.code||'')+'</td>'+
            '<td data-label="Số lượng sử dụng">'+detail.quantity+'</td>'+
            '<td data-label="Số lượng trả"><input type="number" class="quantity-return-input" min="0" value="0"></td>'+
            '<td data-label="Số lượng còn lại">'+remaining+'</td>'+
            '<td data-label="Số sổ">'+detail.ticket+'</td>'+
            '<td data-label="Ghi chú">'+(detail.note||'-')+'</td>'+
            '<td data-label="Xác nhận"><input type="checkbox" class="ticket-checkbox" value="'+detail.ticket+'"></td>';
          managerReturnBody.appendChild(mr);
        });
      }
    });
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

function submitReturnForm(){
    selectedTickets=[];
    var items=[];
    var checkboxes=document.querySelectorAll('#borrowedItemsTable .ticket-checkbox:checked');
    var inputs=document.querySelectorAll('#borrowedItemsTable .quantity-return-input');
    var valid=true;
    checkboxes.forEach(function(cb){ selectedTickets.push(cb.value); });
    inputs.forEach(function(input){
      var tr=input.closest('tr');
      var code=tr.cells[1].innerText;
      var name=tr.cells[0].innerText;
      var qUsed=parseFloat(tr.cells[2].innerText)||0;
      var qRet =parseFloat(input.value)||0;
      var ticket=tr.cells[4].innerText;
      if (qRet<0){ showError('returnErrorMessage','Số lượng trả không hợp lệ.'); valid=false; return; }
      if (selectedTickets.includes(ticket)){
        items.push({ code:code, name:name, quantityUsed:qUsed, quantityReturned:qRet });
      }
    });
    if (!valid || selectedTickets.length===0 || items.length===0){
      showError('returnErrorMessage','Vui lòng chọn số sổ và nhập số lượng trả hợp lệ.');
    return;
    }

    var data={
      timestamp:new Date().toISOString(), type:'Trả', email:userEmail,
      date:new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}),
      tickets:selectedTickets, items:items
    };
    document.getElementById('returnSpinner').style.display='block';
    
    callApi('/submit/return', data)
        .then(() => {
            showSuccess('returnSuccessMessage','Xác nhận đối chiếu thành công!');
            selectedTickets=[]; 
            loadSelfDashboard(); // Tải lại Dashboard để cập nhật tồn kho/sổ chưa đối chiếu
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

function loadTechnicians(){
    document.getElementById('technicianSpinner').style.display='block';
    callApi('/manager/technicians')
        .then(techs => {
            var sel=document.getElementById('technicianEmail');
            sel.innerHTML='<option value="">Chọn kỹ thuật viên</option>';
            (techs||[]).forEach(function(t){ var o=document.createElement('option'); o.value=t.email; o.text=t.email; sel.appendChild(o); });
        })
        .catch(err => {
            showError('technicianErrorMessage','Lỗi tải danh sách: '+err.message);
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
        var json=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{ header:['date','itemCode','itemName','ticket','quantity','note'], skipHeader:true });
        
        if (!json.length){ showError('excelErrorMessage','File Excel trống.'); document.getElementById('excelSpinner').style.display='none'; return; }
        
        // GỌI API GCF để chuẩn hóa dữ liệu
        callApi('/manager/processExcelData', { data: json })
          .then(data => { 
            displayExcelData(data); 
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
function displayExcelData(data){
    excelData=data||[];
    var tbody=document.getElementById('excelDataBody'); tbody.innerHTML='';
    if (!excelData.length){
      tbody.innerHTML='<tr><td colspan="7">Không có dữ liệu</td></tr>';
      document.getElementById('excelDataTable').style.display='none';
      document.getElementById('confirmExcelButton').style.display='none';
      return;
}
    excelData.forEach(function(r){
      var tr=document.createElement('tr');
      tr.innerHTML='<td data-label="Ngày">'+(r.date||'')+'</td><td data-label="Mã vật tư">'+(r.itemCode||'')+'</td><td data-label="Tên vật tư">'+(r.itemName||'')+'</td><td data-label="Số sổ">'+(r.ticket||'')+'</td><td data-label="Số lượng">'+(r.quantity||'')+'</td><td data-label="Email">'+(r.email||'Không xác định')+'</td><td data-label="Ghi chú">'+(r.note||'')+'</td>';
      tbody.appendChild(tr);
    });
    document.getElementById('excelDataTable').style.display='table';
    document.getElementById('confirmExcelButton').style.display='inline-block';
}

// Bổ sung hàm Confirm Data
function confirmExcelData(){
    if (!excelData.length){ showError('excelErrorMessage','Không có dữ liệu để lưu.'); return;
}
    document.getElementById('excelSpinner').style.display='block';
    
    callApi('/manager/saveExcelData', { data: excelData })
      .then(() => {
        showSuccess('excelSuccessMessage','Lưu dữ liệu thành công!');
        excelData=[]; document.getElementById('excelDataBody').innerHTML='';
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

function submitUnusedReturn(){
    var email=document.getElementById('technicianEmail').value;
    var date=document.getElementById('returnUnusedTransactionDate').value;
    var items=[];
    var valid=true;
    var inputs=document.querySelectorAll('#unusedItemsTable .quantity-return-input');
    
    // Tái tạo logic lấy items trả về kho
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

    var data={ timestamp:new Date().toISOString(), type:'Trả', email:email, date:date, items:items, note:'Trả vật tư không sử dụng' };
    document.getElementById('returnUnusedSpinner').style.display='block';
    
    callApi('/submit/return', data)
      .then(() => {
        showSuccess('returnUnusedSuccessMessage','Trả vật tư không sử dụng thành công!');
        document.getElementById('returnUnusedTransactionDate').value='';
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

// ... (Các hàm khác như submitUnusedReturn, loadTicketRanges, saveTicketRanges giữ nguyên) ...

// DOM ready
document.addEventListener('DOMContentLoaded', function(){ initForm(); });
