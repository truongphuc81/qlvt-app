// public/inventory-audit.js

// === BIẾN TOÀN CỤC ===
let systemInventory = {}; // Dữ liệu từ Firestore: { 'Mã': { name, quantity, price, unit } }
let scannedInventory = {}; // Dữ liệu quét thực tế: { 'Mã': số_lượng }
let html5QrCode = null;
// let audioSuccess = new Audio('chime.mp3'); // Đảm bảo bạn có file âm thanh này hoặc bỏ qua
// let audioError = new Audio('error.mp3');   // (Option)

// === KHỞI TẠO ===
document.addEventListener('DOMContentLoaded', async function() {
    auth.onAuthStateChanged(async user => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        document.getElementById('userEmailDisplay').innerText = user.email;
        
        // 1. Tải dữ liệu tồn kho từ Firestore
        await loadSystemInventory();
        
        // 2. Focus vào ô nhập liệu ngay lập tức
        focusInput();
    });

    // Lắng nghe sự kiện Enter ở ô nhập liệu (cho máy quét)
    document.getElementById('scanInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            processInputManual();
        }
    });
});

// Giữ focus luôn ở ô nhập liệu (trừ khi đang mở modal)
function focusInput() {
    if (!Swal.isVisible()) {
        document.getElementById('scanInput').focus();
    }
}
 

// === 1. TẢI DỮ LIỆU TỒN KHO ===
async function loadSystemInventory() {
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><br>Đang đồng bộ dữ liệu từ Cloud...</td></tr>';

    try {
        const collectionName = 'inventory';
        // Chỉ lấy những vật tư có số lượng lớn hơn 0 để kiểm kê
        const querySnapshot = await db.collection(collectionName).where('quantity', '>', 0).get();
        
        systemInventory = {};
        querySnapshot.forEach(doc => {
            const item = doc.data();
            if (item.code) {
                systemInventory[item.code] = {
                    name: item.name,
                    systemQty: Number(item.quantity) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    unit: item.unit
                };
            }
        });

        populateSuggestions(); // Tải gợi ý cho ô nhập liệu
        renderTable();
        
        Swal.fire({
            icon: 'success',
            title: 'Sẵn sàng!',
            text: `Đã tải ${Object.keys(systemInventory).length} mã vật tư có tồn kho để kiểm kê.`,
            timer: 1500,
            showConfirmButton: false
        });

    } catch (error) {
        console.error("Error loading system inventory:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Lỗi tải dữ liệu: ${error.message}. Có thể bạn cần tạo chỉ mục (index) cho collection 'inventory' trên trường 'quantity'. Hãy kiểm tra F12-Console để xem link tạo tự động.</td></tr>`;
    }
}

// === 2. XỬ LÝ QUÉT / NHẬP LIỆU ===

// Tạo danh sách gợi ý cho ô nhập liệu
function populateSuggestions() {
    const dataList = document.getElementById('suggestions-list');
    dataList.innerHTML = ''; // Xóa các gợi ý cũ

    Object.keys(systemInventory).forEach(code => {
        const item = systemInventory[code];
        const option = document.createElement('option');
        // Định dạng gợi ý: "Tên Vật Tư [Mã Vật Tư]" để người dùng thấy cả hai
        option.value = `${item.name} [${code}]`;
        dataList.appendChild(option);
    });
}


async function processInputManual() {
    const inputEl = document.getElementById('scanInput');
    let rawValue = inputEl.value.trim();
    
    if (!rawValue) return;

    let foundCode = null;

    // Regex để tìm mã trong dấu ngoặc vuông, ví dụ: "Tên vật tư [VT001]" -> "VT001"
    const codeMatch = rawValue.match(/\[(.+)\]$/);

    if (codeMatch && codeMatch[1]) {
        // Trường hợp 1: Người dùng chọn từ danh sách gợi ý
        const potentialCode = codeMatch[1];
        if (systemInventory[potentialCode]) {
            foundCode = potentialCode;
        }
    } else if (systemInventory[rawValue]) {
        // Trường hợp 2: Quét mã vạch hoặc nhập chính xác mã
        foundCode = rawValue;
    } else {
        // Trường hợp 3: Nhập tự do (tên hoặc một phần tên) -> tìm kiếm mềm
        const lowerInput = rawValue.toLowerCase();
        // Tìm mã có tên chứa chuỗi nhập vào
        foundCode = Object.keys(systemInventory).find(code => 
            systemInventory[code].name.toLowerCase().includes(lowerInput)
        );
    }

    if (foundCode) {
        await handleScannedItem(foundCode);
        inputEl.value = ''; // Xóa ô nhập sau khi xử lý
    } else {
        // Báo lỗi âm thanh và UI
        // audioError.play().catch(()=>{}); 
        Swal.fire({
            icon: 'error',
            title: 'Không tìm thấy!',
            text: `Không có vật tư nào khớp với "${rawValue}"`,
            timer: 1000,
            showConfirmButton: false
        });
        inputEl.select(); // Bôi đen để nhập lại nhanh
    }
}

async function handleScannedItem(code) {
    const item = systemInventory[code];
    const isQuickMode = document.getElementById('modeQuick').checked;

    if (isQuickMode) {
        // Chế độ Quét Nhanh (+1)
        addQuantity(code, 1);
        playSound();
        scrollToRow(code);
    } else {
        // Chế độ Nhập Số Lượng
        const { value: qty } = await Swal.fire({
            title: `Nhập SL cho: ${item.name}`,
            input: 'number',
            inputValue: 1,
            inputAttributes: { min: 1, step: 1 },
            showCancelButton: true,
            confirmButtonText: 'Thêm',
            didOpen: () => {
                const input = Swal.getInput();
                input.select(); // Tự động bôi đen số để nhập đè
            }
        });

        if (qty) {
            addQuantity(code, Number(qty));
            playSound();
            scrollToRow(code);
        }
    }
}

function addQuantity(code, qty) {
    if (!scannedInventory[code]) {
        scannedInventory[code] = 0;
    }
    scannedInventory[code] += qty;
    renderTable(); // Vẽ lại bảng
}

function removeScanned(code) {
    if (confirm("Bạn muốn xóa kết quả kiểm tra của mã này?")) {
        delete scannedInventory[code];
        renderTable();
    }
}

function playSound() {
    // audioSuccess.play().catch(() => {}); // Cần file chime.mp3
}

// === 3. HIỂN THỊ & TÍNH TOÁN ===
function renderTable() {
    const tbody = document.getElementById('auditTableBody');
    const filterText = document.getElementById('filterTable').value.toLowerCase();
    
    // Gộp danh sách: Tất cả mã trong System + Mã lạ (nếu có logic quét mã lạ)
    // Ở đây ta hiển thị tất cả vật tư trong hệ thống để đối chiếu
    const allCodes = Object.keys(systemInventory); 
    
    let html = '';
    let countScanned = 0;
    let totalRealQty = 0;
    let countDiff = 0;

    // Sắp xếp: Đưa những mã VỪA QUÉT (có trong scannedInventory) lên đầu
    allCodes.sort((a, b) => {
        const aScan = scannedInventory[a] ? 1 : 0;
        const bScan = scannedInventory[b] ? 1 : 0;
        return bScan - aScan; // Scanned trước
    });

    allCodes.forEach(code => {
        const sysItem = systemInventory[code];
        
        // Filter tìm kiếm
        if (filterText && !code.toLowerCase().includes(filterText) && !sysItem.name.toLowerCase().includes(filterText)) {
            return;
        }

        const sysQty = sysItem.systemQty;
        const realQty = scannedInventory[code] || 0;
        const diff = realQty - sysQty;
        const diffVal = diff * sysItem.unitPrice;

        // Tính thống kê
        if (scannedInventory[code] !== undefined) countScanned++;
        totalRealQty += realQty;
        if (diff !== 0 && scannedInventory[code] !== undefined) countDiff++; // Chỉ tính lệch nếu ĐÃ kiểm (realQty=0 mặc định chưa tính là lệch nếu chưa quét)

        // Class màu sắc
        let diffClass = 'diff-zero';
        let rowClass = '';
        if (scannedInventory[code] !== undefined) {
            // Đã quét
            if (diff > 0) diffClass = 'diff-positive'; // Thừa
            else if (diff < 0) diffClass = 'diff-negative'; // Thiếu
            rowClass = 'table-active'; // Đánh dấu dòng đã kiểm
        }

        html += `
            <tr id="row-${code}" class="${rowClass}">
                <td class="fw-bold">${code}</td>
                <td>${sysItem.name} <small class="text-muted">(${sysItem.unit})</small></td>
                <td class="text-center">${sysQty}</td>
                <td class="text-center fw-bold fs-5 text-primary">${realQty > 0 ? realQty : '-'}</td>
                <td class="text-center ${diffClass}">${realQty > 0 || scannedInventory[code] !== undefined ? (diff > 0 ? '+'+diff : diff) : '-'}</td>
                <td class="text-end text-muted small">${diffVal !== 0 ? diffVal.toLocaleString('vi-VN') : '-'}</td>
                <td class="text-center">
                    ${scannedInventory[code] !== undefined ? 
                        `<button class="btn btn-sm btn-outline-danger" onclick="removeScanned('${code}')"><i class="fas fa-trash"></i></button>` 
                        : ''}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // Cập nhật thống kê
    document.getElementById('statScannedCodes').innerText = countScanned + '/' + allCodes.length;
    document.getElementById('statTotalQty').innerText = totalRealQty;
    document.getElementById('statDiffCodes').innerText = countDiff;
}

function filterAuditTable() {
    renderTable();
}

function scrollToRow(code) {
    const row = document.getElementById(`row-${code}`);
    if (row) {
        row.classList.add('just-scanned');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => row.classList.remove('just-scanned'), 1500);
    }
}

// === 4. CÁC TIỆN ÍCH KHÁC ===
function toggleScanMode() {
    document.getElementById('scanInput').focus();
}

function resetAudit() {
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ kết quả kiểm kê hiện tại?")) {
        scannedInventory = {};
        renderTable();
        document.getElementById('scanInput').focus();
    }
}

async function finishAudit() {
    // 1. Tổng hợp dữ liệu lệch
    const reportData = [];
    Object.keys(systemInventory).forEach(code => {
        const sysQty = systemInventory[code].systemQty;
        const realQty = scannedInventory[code] || 0; // Nếu chưa quét coi như 0 (hoặc logic khác tùy bạn)
        
        // Chỉ báo cáo những mã ĐÃ QUÉT hoặc TẤT CẢ? 
        // Thường kiểm kê là phải chốt tất cả. Những cái chưa quét = mất (0).
        // Nhưng để an toàn, ta hỏi người dùng.
        
        const diff = realQty - sysQty;
        if (diff !== 0) {
            reportData.push({
                code: code,
                name: systemInventory[code].name,
                systemQty: sysQty,
                realQty: realQty,
                diff: diff,
                diffValue: diff * systemInventory[code].unitPrice
            });
        }
    });

    if (reportData.length === 0) {
        Swal.fire('Tuyệt vời', 'Kho khớp hoàn toàn 100%!', 'success');
        return;
    }

    // Hiển thị bảng tóm tắt trước khi lưu
    // (Ở đây bạn có thể gọi API để lưu kết quả kiểm kê vào collection 'audit_sessions')
    console.log("Dữ liệu kiểm kê:", reportData);
    Swal.fire({
        title: 'Kết quả kiểm kê',
        text: `Có ${reportData.length} mã vật tư bị lệch. Hãy kiểm tra console hoặc lưu vào database.`,
        icon: 'warning'
    });
    
    // TODO: Gọi API lưu reportData vào Firestore (collection: audits)
}

// === 5. CAMERA SCANNER (Dùng thư viện html5-qrcode) ===
function toggleCamera() {
    const section = document.getElementById('cameraSection');
    if (section.style.display === 'none') {
        section.style.display = 'block';
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }
        html5QrCode.start(
            { facingMode: "environment" }, 
            { fps: 10, qrbox: 250 },
            (decodedText, decodedResult) => {
                // Quét thành công
                console.log(`Scan Code: ${decodedText}`);
                document.getElementById('scanInput').value = decodedText;
                processInputManual();
                // html5QrCode.stop(); // Tắt cam sau 1 lần quét? Tùy chọn.
                // section.style.display = 'none';
            },
            (errorMessage) => {
                // ignore
            }
        ).catch(err => console.log(err));
    } else {
        section.style.display = 'none';
        if (html5QrCode) {
            html5QrCode.stop().then(() => html5QrCode.clear());
        }
    }
}