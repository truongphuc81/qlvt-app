// public/inventory-audit.js

// === BIẾN TOÀN CỤC ===
let systemInventory = {}; // Dữ liệu từ Firestore: { 'Mã': { name, quantity, price, unit } }
let sessionScannedInventory = {}; // Dữ liệu quét thực tế từ session chung
let currentSessionId = null;
let sessionRef = null;
let html5QrCode = null;
let isScanning = false;
let bipAudio = null;
let isAuditSessionFinished = false;
let lastFinishedAuditItems = null;
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
        
        await initializeAuditSession();
        
        // 2. Focus vào ô nhập liệu ngay lập tức
        focusInput();
    });

    // Lắng nghe sự kiện Enter ở ô nhập liệu (cho máy quét)
    document.getElementById('scanInput').addEventListener('keypress', async function (e) {
        if (e.key === 'Enter') {
            await processInputManual();
        }
    });
});

// === SESSION MANAGEMENT ===
async function initializeAuditSession() {
    // Tạm thời dùng ngày hôm nay làm ID cho phiên làm việc
    const today = new Date();
    const dateString = today.getFullYear() + '-' + (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getDate().toString().padStart(2, '0');
    currentSessionId = `audit_${dateString}`;

    sessionRef = db.collection('audit_sessions').doc(currentSessionId);

    try {
        const doc = await sessionRef.get();

        if (!doc.exists) {
            console.log(`Creating new audit session for today: ${currentSessionId}`);
            await sessionRef.set({
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'in_progress', // Set initial status for new session
            });
            isAuditSessionFinished = false;
        } else {
            console.log(`Joining existing audit session: ${currentSessionId}`);
            const sessionData = doc.data();
            if (sessionData && sessionData.status === 'finished') {
                isAuditSessionFinished = true;
                lastFinishedAuditItems = sessionData.finalAuditedItems || null; // Load final audited items
                Swal.fire('Thông báo', 'Phiên kiểm kê này đã được hoàn tất.', 'info');
            } else {
                isAuditSessionFinished = false;
                lastFinishedAuditItems = null; // Clear if not finished
            }
        }

        // Tải dữ liệu gốc của vật tư
        await loadSystemInventory();

        // Lắng nghe thay đổi của session
        sessionRef.collection('items').onSnapshot(snapshot => {
            sessionScannedInventory = {};
            snapshot.forEach(doc => {
                const item = doc.data();
                sessionScannedInventory[item.code] = item.quantity;
            });
            renderTable();
        }, error => {
            console.error("Error listening to audit session:", error);
            Swal.fire('Lỗi Real-time', `Không thể lắng nghe thay đổi của phiên: ${error.message}`, 'error');
        });
        updateFinishButtonState(); // Update button state after initialization

    } catch (error) {
        console.error("Error initializing audit session:", error);
        Swal.fire('Lỗi nghiêm trọng', `Không thể khởi tạo phiên kiểm kê: ${error.message}`, 'error');
    }
}


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
        await addQuantity(code, 1);
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
            await addQuantity(code, Number(qty));
            playSound();
            scrollToRow(code);
        }
    }
}

async function addQuantity(code, qty) {
    try {
        await callApi('/audit/updateItem', {
            auditId: currentSessionId,
            itemCode: code,
            quantity: qty
        });
        // The onSnapshot listener will automatically handle the UI update.
        // No need to call renderTable() here.
    } catch (error) {
        console.error("Error updating item quantity:", error);
        Swal.fire('Lỗi cập nhật', `Không thể cập nhật số lượng: ${error.message}`, 'error');
    }
}

async function removeScanned(code) {
    if (confirm("Bạn muốn xóa kết quả kiểm tra của mã này?")) {
        const currentQty = sessionScannedInventory[code] || 0;
        if (currentQty === 0) return;

        try {
            await callApi('/audit/updateItem', {
                auditId: currentSessionId,
                itemCode: code,
                quantity: -currentQty // Send a negative value to decrease the total
            });
            // UI will update automatically via onSnapshot
        } catch (error) {
            console.error("Error removing item:", error);
            Swal.fire('Lỗi Xóa', `Không thể xóa vật tư: ${error.message}`, 'error');
        }
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

    // Sắp xếp: Đưa những mã VỪA QUÉT (có trong sessionScannedInventory) lên đầu
    allCodes.sort((a, b) => {
        const aScan = sessionScannedInventory[a] ? 1 : 0;
        const bScan = sessionScannedInventory[b] ? 1 : 0;
        return bScan - aScan; // Scanned trước
    });

    allCodes.forEach(code => {
        const sysItem = systemInventory[code];
        
        // Filter tìm kiếm
        if (filterText && !code.toLowerCase().includes(filterText) && !sysItem.name.toLowerCase().includes(filterText)) {
            return;
        }

        const sysQty = sysItem.systemQty;
        const realQty = sessionScannedInventory[code] || 0;
        const diff = realQty - sysQty;
        const diffVal = diff * sysItem.unitPrice;

        // Tính thống kê
        if (sessionScannedInventory[code] !== undefined) countScanned++;
        totalRealQty += realQty;
        if (diff !== 0 && sessionScannedInventory[code] !== undefined) countDiff++; // Chỉ tính lệch nếu ĐÃ kiểm (realQty=0 mặc định chưa tính là lệch nếu chưa quét)

        // Class màu sắc
        let diffClass = 'diff-zero';
        let rowClass = '';
        if (sessionScannedInventory[code] !== undefined) {
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
                <td class="text-center ${diffClass}">${realQty > 0 || sessionScannedInventory[code] !== undefined ? (diff > 0 ? '+'+diff : diff) : '-'}</td>
                <td class="text-end text-muted small">${diffVal !== 0 ? diffVal.toLocaleString('vi-VN') : '-'}</td>
                <td class="text-center">
                    ${sessionScannedInventory[code] !== undefined ? 
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

async function resetAudit() {
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ kết quả kiểm kê hiện tại? Thao tác này sẽ ảnh hưởng đến tất cả mọi người đang tham gia phiên này.")) {
        try {
            await callApi('/audit/resetSession', {
                auditId: currentSessionId
            });
            // UI will update automatically via onSnapshot
            Swal.fire('Đã xóa', 'Toàn bộ kết quả kiểm kê đã được xóa.', 'success');
        } catch (error) {
            console.error("Error resetting audit:", error);
            Swal.fire('Lỗi', `Không thể xóa kết quả kiểm kê: ${error.message}`, 'error');
        }
    }
}

async function finishAudit() {
    if (isAuditSessionFinished) {
        Swal.fire('Thông báo', 'Phiên kiểm kê này đã được hoàn tất và lưu. Không thể hoàn tất lần nữa.', 'info');
        return;
    }

    const { value: confirmFinish } = await Swal.fire({
        title: 'Bạn chắc chắn muốn kết thúc?',
        text: "Hành động này sẽ chốt số liệu kiểm kê và cập nhật tồn kho. Không thể hoàn tác!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Đồng ý kết thúc',
        cancelButtonText: 'Hủy'
    });

    if (confirmFinish) {
        try {
            showLoading('Đang chốt số liệu và cập nhật kho...');
            const result = await callApi('/audit/finishSession', {
                auditId: currentSessionId
            });
            hideLoading();
            Swal.fire('Hoàn tất!', 'Phiên kiểm kê đã được lưu. Tồn kho gốc sẽ được cập nhật sau khi xử lý nghiệp vụ.', 'success');
            isAuditSessionFinished = true; // Mark as finished after successful API call
            // We need to fetch the finalAuditedItems from the backend after finishing the audit
            // For now, we will assume the backend returns it or we can re-fetch the session
            // For simplicity, we will assume 'result' contains the finalAuditedItems if the backend was designed to return it.
            // Since the backend now stores 'finalAuditedItems' in the audit_sessions document, we should refresh the session data.
            // Re-initializing the session or reloading the page would fetch this, but for this specific immediate action,
            // we will simulate setting it. A full re-fetch of the audit session would be more robust.
            // For now, we'll rely on the backend's result message for simplicity in this client-side change.
            // The proper way would be to call initializeAuditSession() again or a specific function to fetch only the session data.
            // Let's assume the backend 'result' contains the final items.
            // If the result object structure from the API changes, this part might need adjustment.
            // For now, we set lastFinishedAuditItems to the result of the backend.
            // Based on data-processor.js, the backend now stores `finalAuditedItems` in `audit_sessions` document.
            // So we need to re-fetch the session or rely on it being present in the result, which it currently is not.
            // The simplest approach is to make a quick read of the audit session after finish.
            const updatedAuditDoc = await db.collection('audit_sessions').doc(currentSessionId).get();
            if (updatedAuditDoc.exists) {
                lastFinishedAuditItems = updatedAuditDoc.data().finalAuditedItems || null;
            } else {
                lastFinishedAuditItems = null; // Should not happen if finish was successful
            }

        } catch (error) {
            hideLoading();
            console.error("Error finishing audit:", error);
            Swal.fire('Lỗi', `Không thể kết thúc phiên kiểm kê: ${error.message}`, 'error');
        } finally {
            updateFinishButtonState(); // Ensure button state is updated even on error
        }
    }
}

// Helper functions for loading indicator
function showLoading(message) {
    Swal.fire({
        title: message,
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
}

function hideLoading() {
    Swal.close();
}

function updateFinishButtonState() {
    const finishButton = document.getElementById('finishAuditBtn');
    const exportDiffButton = document.getElementById('exportDiffExcelBtn');
    const newAuditButton = document.getElementById('newAuditBtn');
    const resetButton = document.querySelector('button[onclick="resetAudit()"]'); // Assuming reset button is always present

    if (finishButton) {
        finishButton.disabled = isAuditSessionFinished;
        if (isAuditSessionFinished) {
            finishButton.textContent = '✅ Đã Hoàn Tất';
            finishButton.classList.remove('btn-success');
            finishButton.classList.add('btn-secondary');
            
            // Show new buttons
            if (exportDiffButton) exportDiffButton.style.display = 'block';
            if (newAuditButton) newAuditButton.style.display = 'block';
            if (resetButton) resetButton.style.display = 'none'; // Hide reset button
        } else {
            finishButton.textContent = '✅ Hoàn Tất & Lưu Kết Quả';
            finishButton.classList.remove('btn-secondary');
            finishButton.classList.add('btn-success');

            // Hide new buttons
            if (exportDiffButton) exportDiffButton.style.display = 'none';
            if (newAuditButton) newAuditButton.style.display = 'none';
            if (resetButton) resetButton.style.display = 'block'; // Show reset button
        }
    }
}

// === NEW FUNCTIONS FOR POST-AUDIT ACTIONS ===

async function exportDifferencesToExcel() {
    if (!lastFinishedAuditItems || lastFinishedAuditItems.length === 0) {
        Swal.fire('Thông báo', 'Không có dữ liệu chênh lệch để xuất Excel.', 'info');
        return;
    }

    const diffItems = lastFinishedAuditItems.filter(item => item.difference !== 0);

    if (diffItems.length === 0) {
        Swal.fire('Thông báo', 'Không có vật tư nào bị chênh lệch.', 'info');
        return;
    }

    let csvContent = "Mã Vật Tư,Tên Vật Tư,Số Lượng Tồn Hệ Thống,Số Lượng Thực Tế Kiểm Kê,Chênh Lệch\n";
    diffItems.forEach(item => {
        csvContent += `${item.code},"${item.name}",${item.currentSystemQuantity},${item.auditedQuantity},${item.difference}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) { // Feature detection
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `vat_tu_chenh_lech_kiem_kho_${currentSessionId}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        Swal.fire('Lỗi', 'Trình duyệt của bạn không hỗ trợ tải file CSV trực tiếp.', 'error');
    }
}

function startNewAuditSession() {
    // Simply reload the page to start a new session (logic in DOMContentLoaded)
    window.location.reload();
}

// === 5. CAMERA SCANNER (Dùng thư viện html5-qrcode) ===
function toggleCamera() {
    const section = document.getElementById('cameraSection');
    if (section.style.display === 'none') {
        // Initialize audio on user gesture to avoid autoplay issues
        if (!bipAudio) {
            bipAudio = new Audio('BIP.mp3');
        }

        section.style.display = 'block';
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }
        html5QrCode.start(
            { facingMode: "environment" }, 
            { fps: 10, qrbox: 250 },
            (decodedText, decodedResult) => {
                // ---- START DELAY LOGIC ----
                if (isScanning) {
                    return; // Đang trong thời gian chờ, bỏ qua lần quét này
                }
                isScanning = true;
                // ---- END DELAY LOGIC ----

                // Quét thành công
                console.log(`Scan Code: ${decodedText}`);
                document.getElementById('scanInput').value = decodedText;
                processInputManual();
                
                // Play sound on successful scan
                if (bipAudio) {
                    bipAudio.play().catch(e => console.error("Audio play failed:", e));
                }

                // Thêm hiệu ứng UI để người dùng biết đã quét thành công
                const readerElement = document.getElementById('reader');
                if (readerElement) {
                    readerElement.classList.add('scan-success-highlight');
                }

                // Đặt thời gian chờ trước khi cho phép quét lại
                setTimeout(() => {
                    isScanning = false;
                    if (readerElement) {
                        readerElement.classList.remove('scan-success-highlight');
                    }
                }, 1000); // Chờ 1 giây
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