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
let isInitialLoadComplete = false;
let isReadyForScanning = false;
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
    });

    // Lắng nghe sự kiện Enter ở ô nhập liệu (cho máy quét)
    document.getElementById('scanInput').addEventListener('keypress', async function (e) {
        if (e.key === 'Enter') {
            await processInputManual();
        }
    });

    // Tự động focus vào ô quét khi có phím bấm từ máy quét mã vạch
    document.addEventListener('keydown', function(e) {
        // Block keyboard-to-input focus until the app is fully initialized.
        if (!isReadyForScanning) return;

        const target = e.target;
        const isTypingInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        // Danh sách các phím chức năng/điều khiển không nên kích hoạt focus.
        const ignoredKeys = [
            'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
            'PageUp', 'PageDown', 'Tab', 'Escape', 'Enter',
            'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
        ];

        // Điều kiện để focus:
        // 1. Người dùng không đang gõ ở một ô input/textarea/select khác.
        // 2. Không có cửa sổ popup (SweetAlert) đang hiển thị.
        // 3. Phím được nhấn không phải là phím điều khiển/chức năng.
        if (!isTypingInInput && !Swal.isVisible() && !ignoredKeys.includes(e.key)) {
            const scanInput = document.getElementById('scanInput');
            
            // Nếu tìm thấy ô input và nó chưa được focus
            if (scanInput && document.activeElement !== scanInput) {
                // Focus vào ô input.
                scanInput.focus();

                // Ngăn hành động mặc định của trình duyệt để tránh ký tự bị nhập 2 lần
                // hoặc bị "mất" do timing. Thay vào đó, ta sẽ tự thêm ký tự vào.
                e.preventDefault();

                // Nối ký tự vừa bấm vào giá trị hiện tại của ô input.
                // Điều này đảm bảo ký tự đầu tiên từ máy quét không bị mất.
                scanInput.value += e.key;
            }
        }
    });
});

// === SESSION MANAGEMENT ===
async function initializeAuditSession() {
    console.log("[initializeAuditSession] Bắt đầu phiên cộng tác...");
    // Tạm thời xóa query string khỏi URL để tránh nó lưu lại trong history
    if (window.location.search.includes('reload')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const storageKey = 'activeAuditSessionId';
    let activeSessionId = localStorage.getItem(storageKey);
    console.log(`[initializeAuditSession] Giá trị ${storageKey} từ localStorage là: ${activeSessionId}`);

    const today = new Date();
    const dateString = today.getFullYear() + '-' + (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getDate().toString().padStart(2, '0');
    const dailySessionId = `audit_${dateString}`;

    // Kiểm tra xem ID được lưu trữ có phải là ID có dấu thời gian cũ không (có nhiều hơn 1 dấu gạch dưới)
    const isTimestampedId = activeSessionId && (activeSessionId.match(/_/g) || []).length > 1;

    if (activeSessionId && !isTimestampedId) {
        // ID hợp lệ được tìm thấy, sử dụng nó.
        currentSessionId = activeSessionId;
        console.log(`[initializeAuditSession] Đã tìm thấy ID phiên hợp lệ. Sử dụng: ${currentSessionId}`);
    } else {
        // Không tìm thấy ID hoặc tìm thấy ID có dấu thời gian không hợp lệ.
        // Buộc người dùng vào phiên hàng ngày chính xác.
        if (isTimestampedId) {
            console.log(`[initializeAuditSession] Vô hiệu hóa ID phiên có dấu thời gian cũ: ${activeSessionId}`);
        }
        currentSessionId = dailySessionId;
        console.log(`[initializeAuditSession] Không có phiên hợp lệ. Sử dụng phiên hàng ngày mặc định: ${currentSessionId}`);
        localStorage.setItem(storageKey, currentSessionId);
    }
    
    console.log(`[initializeAuditSession] ID phiên cuối cùng được sử dụng: ${currentSessionId}`);
    
    // Update UI with Session ID
    const sessionIdDisplay = document.getElementById('sessionIdDisplay');
    if (sessionIdDisplay) {
        sessionIdDisplay.innerText = currentSessionId.replace('audit_', '');
        if (currentSessionId !== dailySessionId) {
             sessionIdDisplay.classList.add('text-warning');
             sessionIdDisplay.title = "Bạn đang ở phiên cũ hoặc phiên tùy chỉnh";
        }
    }

    sessionRef = db.collection('audit_sessions').doc(currentSessionId);

    // Tải dữ liệu hệ thống trước để có tổng số vật tư
    const totalItemCount = await loadSystemInventory();
    
    // Biến cờ để ngăn chặn vòng lặp tạo phiên liên tục
    let hasTriedCreating = false;

    // Listener 1: Lắng nghe trạng thái của TÀI LIỆU PHIÊN (status, etc.)
    sessionRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            if (hasTriedCreating) return; // Nếu đã thử tạo rồi thì không thử lại để tránh loop

            console.log(`Creating new audit session for today: ${currentSessionId}`);
            hasTriedCreating = true; // Đánh dấu là đã thử

            try {
                await sessionRef.set({
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'in_progress'
                });
            } catch (error) {
                if (error.code === 'permission-denied') {
                    console.warn("Waiting for admin to create session...");
                    // Show non-blocking toast
                    Swal.fire({
                        icon: 'info', title: 'Đang chờ...',
                        text: 'Phiên kiểm kê chưa được tạo. Vui lòng chờ Quản lý khởi tạo hoặc Đổi phiên.',
                        toast: true, position: 'top-end', showConfirmButton: false, timer: 10000
                    });
                } else {
                    console.error("Error creating new session:", error);
                    Swal.fire('Lỗi nghiêm trọng', `Không thể tạo phiên mới: ${error.message}`, 'error');
                }
            }
            return;
        }

        const sessionData = doc.data();
        console.log(`[Session Listener] Trạng thái phiên cập nhật: ${sessionData.status}`);

        if (sessionData.status === 'finished') {
            isAuditSessionFinished = true;
            isInitialLoadComplete = false; // Reset for a potential new session
            lastFinishedAuditItems = sessionData.finalAuditedItems || null;
            if (Swal.isLoading()) hideLoading();
        } else if (sessionData.status === 'processing') {
            isAuditSessionFinished = true;
            isInitialLoadComplete = false; // Reset
            showLoading('Phiên đang được chốt số liệu, vui lòng chờ...');
        } else { // 'in_progress'
            isAuditSessionFinished = false;
            lastFinishedAuditItems = null;
            if (Swal.isLoading()) {
                hideLoading();
            }

            if (!isInitialLoadComplete) {
                Swal.fire({
                    icon: 'success',
                    title: 'Sẵn sàng',
                    text: `Đã tải ${totalItemCount} vật tư. Có thể bắt đầu quét.`,
                    timer: 1500,
                    showConfirmButton: false,
                    didClose: () => {
                        focusInput();
                        isReadyForScanning = true;
                    }
                });
                isInitialLoadComplete = true;
            } else {
                focusInput();
                isReadyForScanning = true;
            }
        }
        
        updateFinishButtonState();
    }, (error) => {
        console.error("Lỗi lắng nghe tài liệu phiên:", error);
        Swal.fire('Lỗi Real-time', `Không thể lắng nghe thay đổi của phiên: ${error.message}`, 'error');
    });

    // Listener 2: Lắng nghe các VẬT TƯ ĐÃ QUÉT trong collection con 'items'
    sessionRef.collection('items').onSnapshot(snapshot => {
        sessionScannedInventory = {};
        snapshot.forEach(doc => {
            const item = doc.data();
            sessionScannedInventory[item.code] = item.quantity;
        });
        renderTable();
    }, error => {
        console.error("Lỗi lắng nghe các vật tư đã quét:", error);
        Swal.fire('Lỗi Real-time', `Không thể lắng nghe thay đổi của các vật tư đã quét: ${error.message}`, 'error');
    });
}

// Giữ focus luôn ở ô nhập liệu (trừ khi đang mở modal hoặc camera mobile đang bật)
function focusInput() {
    // Không focus vào ô input nếu camera đang bật trên giao diện mobile,
    // vì lúc đó ô input đã bị ẩn đi để ưu tiên giao diện camera.
    const isMobileCameraOn = document.body.classList.contains('camera-on-mobile');
    if (!Swal.isVisible() && !isMobileCameraOn) {
        document.getElementById('scanInput').focus();
    }
}
 

// === 1. TẢI DỮ LIỆU TỒN KHO ===
async function loadSystemInventory() {
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><br>Đang đồng bộ dữ liệu từ Cloud...</td></tr>';

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
                    group: item.itemGroup, // Fix: Changed to itemGroup
                    systemQty: Number(item.quantity) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    unit: item.unit
                };
            }
        });

        populateSuggestions(); // Tải gợi ý cho ô nhập liệu
        renderTable();
        
        // Trả về số lượng vật tư đã tải để hàm khác có thể sử dụng
        return Object.keys(systemInventory).length;

    } catch (error) {
        console.error("Error loading system inventory:", error);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Lỗi tải dữ liệu: ${error.message}. Có thể bạn cần tạo chỉ mục (index) cho collection 'inventory' trên trường 'quantity'. Hãy kiểm tra F12-Console để xem link tạo tự động.</td></tr>`;
        return 0; // Trả về 0 nếu có lỗi
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
    // --- FIX: Block scanning if session is finished ---
    if (isAuditSessionFinished) {
        Swal.fire('Phiên đã kết thúc', 'Không thể quét thêm vì phiên đã được hoàn tất.', 'warning');
        document.getElementById('scanInput').value = ''; // Clear input
        return;
    }
    // --- END FIX ---

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

        const isCameraScanning = html5QrCode && html5QrCode.isScanning;

        // Tạm dừng camera nếu đang chạy để tránh lỗi khi modal hiển thị
        if (isCameraScanning) {
            await html5QrCode.stop().catch(err => console.error("Không thể tạm dừng camera:", err));
        }

        // FIX: Blur the main input before opening the modal to avoid focus conflicts.
        document.getElementById('scanInput').blur();

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

        // Khởi động lại camera nếu nó đã bật trước đó và giao diện camera vẫn còn
        const cameraSection = document.getElementById('cameraSection');
        if (isCameraScanning && cameraSection.style.display !== 'none') {
            await startScannerProcess().catch(err => {
                console.error("Không thể khởi động lại camera:", err);
                // If restart fails, fully shut down the camera UI
                cameraSection.style.display = 'none';
                if (window.innerWidth <= 767.98) {
                    document.body.classList.remove('camera-on-mobile');
                }
            });
        }

        // After the modal closes, regardless of the outcome, return focus to the main input.
        focusInput();
    }
}

// Tối ưu hóa: Dùng "Optimistic Update" để tăng tốc độ phản hồi của giao diện
function addQuantity(code, qty) {
    // 1. Lạc quan: Lấy số lượng hiện tại và tính toán số lượng mới
    const currentQty = sessionScannedInventory[code] || 0;
    const newQty = currentQty + qty;

    // 2. Cập nhật trạng thái cục bộ (local state) ngay lập tức
    sessionScannedInventory[code] = newQty;
    
    // 3. Vẽ lại bảng với trạng thái mới để người dùng thấy ngay lập tức
    renderTable(); 
    
    // Update Mobile UI Last Scanned
    updateMobileLastScanned(code, newQty);

    // 4. Gọi API ở chế độ nền (không await) để đồng bộ với server
    callApi('/audit/updateItem', {
        auditId: currentSessionId,
        itemCode: code,
        quantity: qty // Backend sẽ dùng increment, nên ta vẫn gửi số lượng thêm vào
    }).catch(error => {
        // 5. Xử lý lỗi nếu gọi API thất bại: Hoàn tác lại thay đổi trên UI
        console.error("Lỗi cập nhật lạc quan, đang hoàn tác UI:", error);
        Swal.fire('Lỗi Đồng Bộ', `Không thể lưu thay đổi lên máy chủ: ${error.message}. Giao diện sẽ được hoàn tác.`, 'error');
        
        // Hoàn tác trạng thái cục bộ về giá trị ban đầu
        sessionScannedInventory[code] = currentQty;
        
        // Vẽ lại bảng với trạng thái đã hoàn tác
        renderTable(); 
    });
}

// Tối ưu hóa: Dùng "Optimistic Update" và cải thiện hộp thoại xác nhận
function removeScanned(code) {
    // Dùng Swal để có hộp thoại đẹp hơn confirm()
    Swal.fire({
        title: 'Xác nhận xóa',
        text: "Bạn muốn xóa kết quả kiểm kê của mã vật tư này?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Đồng ý, xóa!',
        cancelButtonText: 'Hủy'
    }).then((result) => {
        if (result.isConfirmed) {
            const currentQty = sessionScannedInventory[code] || 0;
            if (currentQty === 0) return;

            // 1. Lạc quan: Cập nhật trạng thái cục bộ (đặt lại là 0)
            sessionScannedInventory[code] = 0; 
            
            // 2. Vẽ lại bảng ngay lập tức
            renderTable();

            // 3. Gọi API ở chế độ nền để xóa trên server
            callApi('/audit/updateItem', {
                auditId: currentSessionId,
                itemCode: code,
                quantity: -currentQty // Gửi giá trị âm để giảm tổng số trên server về 0
            }).catch(error => {
                // 4. Xử lý lỗi nếu gọi API thất bại
                console.error("Lỗi xóa lạc quan, đang hoàn tác UI:", error);
                Swal.fire('Lỗi Xóa', `Không thể xóa vật tư khỏi máy chủ: ${error.message}.`, 'error');

                // Hoàn tác trạng thái cục bộ
                sessionScannedInventory[code] = currentQty;
                
                // Vẽ lại bảng
                renderTable();
            });
        }
    });
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

    // Sắp xếp: 1. Đã quét lên đầu, 2. Theo Nhóm VTHH, 3. Theo Tên
    allCodes.sort((a, b) => {
        const itemA = systemInventory[a];
        const itemB = systemInventory[b];
        const aScanned = sessionScannedInventory[a] !== undefined;
        const bScanned = sessionScannedInventory[b] !== undefined;

        // Ưu tiên 1: Hàng đã quét luôn ở trên cùng
        if (aScanned !== bScanned) {
            return bScanned - aScanned;
        }

        // Ưu tiên 2: Sắp xếp theo tên Nhóm VTHH
        const groupA = itemA.group || 'Chưa phân nhóm';
        const groupB = itemB.group || 'Chưa phân nhóm';
        if (groupA !== groupB) {
            return groupA.localeCompare(groupB);
        }

        // Ưu tiên 3: Sắp xếp theo tên vật tư
        return (itemA.name || '').localeCompare(itemB.name || '');
    });

    allCodes.forEach(code => {
        const sysItem = systemInventory[code];
        
        // Filter tìm kiếm
        if (filterText && !code.toLowerCase().includes(filterText) && !sysItem.name.toLowerCase().includes(filterText) && !(sysItem.group && sysItem.group.toLowerCase().includes(filterText))) {
            return;
        }

        const sysQty = sysItem.systemQty;
        const realQty = sessionScannedInventory[code] || 0;
        const diff = realQty - sysQty;
        const diffVal = diff * sysItem.unitPrice;

        // Tính thống kê
        if (sessionScannedInventory[code] !== undefined) countScanned++;
        totalRealQty += realQty;
        if (diff !== 0 && sessionScannedInventory[code] !== undefined) countDiff++;

        // Class màu sắc
        let diffClass = 'diff-zero';
        let rowClass = '';
        if (sessionScannedInventory[code] !== undefined) {
            // Đã quét
            if (diff > 0) diffClass = 'diff-positive';
            else if (diff < 0) diffClass = 'diff-negative';
            rowClass = 'table-active'; // Đánh dấu dòng đã kiểm
        }

        html += `
            <tr id="row-${code}" class="${rowClass}">
                <td>${sysItem.group || '<i class="text-muted">Chưa có</i>'}</td>
                <td class="fw-bold">${code}</td>
                <td>
                    ${sysItem.name} <small class="text-muted">(${sysItem.unit})</small>
                </td>
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

function updateMobileLastScanned(code, totalQty) {
    const item = systemInventory[code];
    if (!item) return;

    const nameEl = document.getElementById('mobileLastItemName');
    const codeEl = document.getElementById('mobileLastItemCode');
    const qtyEl = document.getElementById('mobileLastItemQty');
    const container = document.getElementById('mobileLastScanned');

    if (nameEl && codeEl && qtyEl && container) {
        nameEl.innerText = item.name;
        codeEl.innerText = code;
        qtyEl.innerText = totalQty;
        container.style.display = 'block';
        
        // Highlight animation
        container.style.backgroundColor = '#d1e7dd';
        setTimeout(() => { container.style.backgroundColor = '#e8f5e9'; }, 500);
    }

    // Popup Toast for Mobile (Confirmation)
    if (window.innerWidth <= 768 && typeof Swal !== 'undefined') {
         const Toast = Swal.mixin({
            toast: true,
            position: 'bottom',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: false
        });
        Toast.fire({
            icon: 'success',
            title: item.name,
            text: `Tổng: ${totalQty} ${item.unit || ''}`
        });
    }
}

// === 4. CÁC TIỆN ÍCH KHÁC ===
function toggleScanMode() {
    document.getElementById('scanInput').focus();
}

async function changeSessionId() {
    showLoading('Đang tải danh sách phiên...');
    try {
        // Try to list sessions sorted by date
        const snapshot = await db.collection('audit_sessions')
                                 .orderBy('createdAt', 'desc')
                                 .limit(20)
                                 .get();
        hideLoading();

        if (snapshot.empty) {
            manualEnterSessionId("Chưa tìm thấy phiên nào. Hãy nhập ID thủ công:");
            return;
        }

        const sessions = {};
        // Option to enter manually
        sessions['MANUAL'] = '✏️ Nhập thủ công...';
        
        let hasActiveSession = false;
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Chỉ hiện phiên đang mở (in_progress)
            if (data.status !== 'in_progress') return;

            hasActiveSession = true;
            let label = doc.id.replace('audit_', 'Ngày ');
            label += " (Đang mở)";
            
            if (doc.id === currentSessionId) label += " ✅";
            sessions[doc.id] = label;
        });

        if (!hasActiveSession) {
             manualEnterSessionId("Không tìm thấy phiên đang mở nào gần đây. Hãy nhập ID thủ công:");
             return;
        }

        const { value: selectedId } = await Swal.fire({
            title: 'Chọn Phiên Kiểm Kê',
            input: 'select',
            inputOptions: sessions,
            inputValue: currentSessionId,
            showCancelButton: true,
            confirmButtonText: 'Tham gia',
            cancelButtonText: 'Hủy'
        });

        if (selectedId) {
            if (selectedId === 'MANUAL') {
                manualEnterSessionId();
            } else if (selectedId !== currentSessionId) {
                localStorage.setItem('activeAuditSessionId', selectedId);
                window.location.reload();
            }
        }

    } catch (error) {
        hideLoading();
        console.warn("Cannot list sessions (missing index or permission), falling back to manual.", error);
        manualEnterSessionId();
    }
}

async function manualEnterSessionId(title = 'Nhập ID phiên bạn muốn tham gia') {
    const { value: newId } = await Swal.fire({
        title: 'Đổi Phiên Thủ Công',
        text: title,
        input: 'text',
        inputValue: currentSessionId,
        placeholder: 'VD: audit_2026-01-05',
        showCancelButton: true,
        confirmButtonText: 'Chuyển',
        cancelButtonText: 'Hủy',
        inputValidator: (value) => {
            if (!value) return 'Vui lòng nhập ID phiên!';
        }
    });

    if (newId) {
        localStorage.setItem('activeAuditSessionId', newId);
        window.location.reload();
    }
}

function signOutAndExit() {
    // Clear the active session so the next login starts fresh
    localStorage.removeItem('activeAuditSessionId');
    console.log('Đã xoá activeAuditSessionId từ localStorage.');
    // Sign out from Firebase
    firebase.auth().signOut().then(() => {
        // onAuthStateChanged will handle the redirect to index.html
        console.log('Đăng xuất thành công.');
    }).catch((error) => {
        console.error('Lỗi đăng xuất:', error);
        // Still try to redirect
        window.location.href = 'index.html';
    });
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
        Swal.fire('Thông báo', 'Phiên kiểm kê này đã được hoàn tất hoặc đang trong quá trình xử lý.', 'info');
        return;
    }

    const { value: confirmFinish } = await Swal.fire({
        title: 'Bạn chắc chắn muốn kết thúc?',
        text: "Hành động này sẽ chốt số liệu kiểm kê. Không thể hoàn tác!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Đồng ý kết thúc',
        cancelButtonText: 'Hủy'
    });

    if (confirmFinish) {
        // Hiển thị loading tạm thời trong lúc chờ API được gọi
        showLoading('Đang gửi yêu cầu kết thúc phiên...');
        
        try {
            // Chỉ cần gọi API. Mọi thay đổi trên giao diện (chuyển sang 'processing', rồi 'finished')
            // sẽ được trình lắng nghe onSnapshot ở trên tự động xử lý.
            await callApi('/audit/finishSession', {
                auditId: currentSessionId
            });
            // Không cần làm gì ở đây cả. Giao diện sẽ tự cập nhật.
        } catch (error) {
            hideLoading(); // Nếu API call thất bại thì phải tắt loading
            console.error("Error finishing audit:", error);
            Swal.fire('Lỗi', `Không thể kết thúc phiên kiểm kê: ${error.message}`, 'error');
        }
        // Không cần khối 'finally' hay gọi 'updateFinishButtonState()' nữa.
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
    const exportReportButton = document.getElementById('exportFullReportBtn');
    const newAuditButton = document.getElementById('newAuditBtn');
    const resetButton = document.querySelector('button[onclick="resetAudit()"]'); 

    if (finishButton) {
        finishButton.disabled = isAuditSessionFinished;
        if (isAuditSessionFinished) {
            finishButton.textContent = '✅ Đã Hoàn Tất';
            finishButton.classList.remove('btn-success');
            finishButton.classList.add('btn-secondary');
            
            // Show new buttons
            if (exportReportButton) exportReportButton.style.display = 'block';
            if (newAuditButton) newAuditButton.style.display = 'block';
            if (resetButton) resetButton.style.display = 'none'; 
        } else {
            finishButton.textContent = '✅ Hoàn Tất & Lưu Kết Quả';
            finishButton.classList.remove('btn-secondary');
            finishButton.classList.add('btn-success');

            // Hide new buttons
            if (exportReportButton) exportReportButton.style.display = 'none';
            if (newAuditButton) newAuditButton.style.display = 'none';
            if (resetButton) resetButton.style.display = 'block'; 
        }
    }
}

// === NEW FUNCTIONS FOR POST-AUDIT ACTIONS ===

async function exportFullReport() {
    if (!lastFinishedAuditItems) return;
    
    showLoading('Đang tổng hợp dữ liệu báo cáo...');
    
    try {
        // 1. Fetch detailed scan info to get "User Scanned"
        const sessionItemsSnap = await db.collection('audit_sessions').doc(currentSessionId).collection('items').get();
        const scannedByMap = {};
        
        sessionItemsSnap.forEach(doc => {
            const data = doc.data();
            const users = [];
            if (data.scannedBy) {
                Object.values(data.scannedBy).forEach( u => {
                     // users.push(`${u.email} (${u.quantity})`);
                     users.push(u.email);
                });
            }
            scannedByMap[data.code] = [...new Set(users)].join(', '); // Unique emails
        });

        // 2. Build Data Rows (Combine System Inventory and Audited Items)
        const auditedMap = new Map();
        lastFinishedAuditItems.forEach(item => auditedMap.set(item.code, item));

        // Union of all codes
        const allCodes = new Set([...Object.keys(systemInventory), ...auditedMap.keys()]);
        let rows = [];

        allCodes.forEach(code => {
            const sysItem = systemInventory[code] || {};
            const auditItem = auditedMap.get(code);

            // Base info
            const name = sysItem.name || (auditItem ? auditItem.name : code);
            const group = sysItem.group || 'Chưa phân nhóm';
            const unit = sysItem.unit || '';
            const price = sysItem.unitPrice || 0;

            // Quantities
            // If audited, use recorded system qty. If not, use current system qty.
            const sysQty = auditItem ? auditItem.currentSystemQuantity : (sysItem.systemQty || 0);
            const realQty = auditItem ? auditItem.auditedQuantity : 0;
            
            // Calculate Difference
            // If audited, use recorded diff. If not, diff is (0 - sysQty)
            const diffQty = auditItem ? auditItem.difference : (realQty - sysQty);

            // Values
            const sysVal = sysQty * price;
            const realVal = realQty * price;
            const diffVal = diffQty * price;

            const scanner = scannedByMap[code] || (auditItem ? '' : 'Chưa kiểm');

            rows.push({
                "Nhóm vật tư": group,
                "Mã vật tư": code,
                "Tên vật tư": name,
                "Đơn vị": unit,
                "SL Phần mềm": sysQty,
                "Giá trị PM": sysVal,
                "SL Thực tế": realQty,
                "Giá trị TT": realVal,
                "SL Chênh lệch": diffQty,
                "Giá trị CL": diffVal,
                "Người quét": scanner
            });
        });

        // Sort by Group then Name
        rows.sort((a, b) => {
            if (a["Nhóm vật tư"] !== b["Nhóm vật tư"]) {
                return a["Nhóm vật tư"].localeCompare(b["Nhóm vật tư"]);
            }
            return a["Tên vật tư"].localeCompare(b["Tên vật tư"]);
        });

        // 3. Export using XLSX
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "KiemKe");
        XLSX.writeFile(wb, `BaoCao_KiemKe_${currentSessionId}.xlsx`);
        
        hideLoading();

    } catch (e) {
        hideLoading();
        console.error(e);
        Swal.fire("Lỗi", "Không thể xuất báo cáo: " + e.message, "error");
    }
}

function startNewAuditSession() {
    Swal.fire({
        title: 'Bắt đầu phiên mới?',
        text: "Hành động này sẽ xóa dữ liệu phiên hiện tại và bắt đầu một phiên kiểm kê mới cho tất cả mọi người.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Đồng ý, tạo phiên mới!',
        cancelButtonText: 'Hủy'
    }).then((result) => {
        if (result.isConfirmed) {
            showLoading('Đang chuẩn bị phiên mới...');

            // 1. Xác định ID phiên mặc định trong ngày.
            const today = new Date();
            const dateString = today.getFullYear() + '-' + (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getDate().toString().padStart(2, '0');
            const dailySessionId = `audit_${dateString}`;

            // 2. Đặt ID này làm ID hoạt động trong localStorage.
            localStorage.setItem('activeAuditSessionId', dailySessionId);

            // 3. Lấy tham chiếu đến tài liệu của phiên này.
            const dailySessionRef = db.collection('audit_sessions').doc(dailySessionId);

            // 4. Cập nhật trạng thái của nó về 'in_progress'.
            dailySessionRef.update({ status: 'in_progress' })
                .then(() => {
                    // 5. Gọi API hiện có để xóa tất cả các mục đã quét trong phiên đó.
                    return callApi('/audit/resetSession', {
                        auditId: dailySessionId
                    });
                })
                .then(() => {
                    // 6. Tải lại trang để bắt đầu.
                    window.location.href = window.location.pathname + '?reload=' + Date.now();
                })
                .catch(error => {
                    hideLoading();
                    console.error("Lỗi khi bắt đầu phiên kiểm kê mới:", error);
                    Swal.fire('Lỗi', `Không thể bắt đầu phiên mới: ${error.message}`, 'error');
                });
        }
    });
}

// === 5. CAMERA SCANNER (Dùng thư viện html5-qrcode) ===

// Tách hàm xử lý khi quét thành công để có thể tái sử dụng
const onScanSuccess = (decodedText, decodedResult) => {
    if (isScanning) return;
    isScanning = true;

    console.log(`Scan Code: ${decodedText}`);
    document.getElementById('scanInput').value = decodedText;
    
    // Hàm này bây giờ sẽ xử lý việc tạm dừng/tiếp tục camera nếu cần
    processInputManual(); 

    if (bipAudio) {
        bipAudio.play().catch(e => console.error("Audio play failed:", e));
    }
    
    const isMobile = window.innerWidth <= 767.98;
    const highlightElement = isMobile ? document.body : document.getElementById('reader');
    if (highlightElement) {
        highlightElement.classList.add('scan-success-highlight');
    }

    setTimeout(() => {
        isScanning = false;
        if (highlightElement) {
            highlightElement.classList.remove('scan-success-highlight');
        }
    }, 1000);
};

// Hàm riêng để khởi động quá trình quét
function startScannerProcess() {
    const isMobile = window.innerWidth <= 767.98;
    // Cấu hình camera, cho box nhỏ hơn trên mobile
    const qrboxConfig = isMobile ? { width: 200, height: 200 } : 250;

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }

    return html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxConfig },
        onScanSuccess,
        (errorMessage) => { /* ignore */ }
    );
}

// Hàm bật/tắt camera chính (đã được tái cấu trúc)
async function toggleCamera() {
    const section = document.getElementById('cameraSection');
    const isMobile = window.innerWidth <= 767.98;

    if (section.style.display === 'none') {
        // === BẬT CAMERA ===
        if (!bipAudio) bipAudio = new Audio('BIP.mp3');

        section.style.display = 'block';
        if (isMobile) document.body.classList.add('camera-on-mobile');
        
        // Chờ UI render xong mới khởi động camera
        await new Promise(r => setTimeout(r, 100));

        try {
            await startScannerProcess();
        } catch (err) {
            console.error("Camera start failed:", err);
            section.style.display = 'none';
            if (isMobile) document.body.classList.remove('camera-on-mobile');
            Swal.fire("Lỗi Camera", "Không thể khởi động camera: " + err, "error");
        }

    } else {
        // === TẮT CAMERA ===
        try {
            if (html5QrCode) {
                // Thử dừng camera. Nếu đang không chạy, nó có thể throw lỗi, ta sẽ catch
                await html5QrCode.stop();
            }
        } catch (err) {
            console.warn("Camera stop warning:", err);
        } finally {
            // Luôn ẩn UI dù stop thành công hay thất bại
            section.style.display = 'none';
            if (isMobile) document.body.classList.remove('camera-on-mobile');
            // Reset instance để đảm bảo lần sau khởi tạo sạch sẽ
            html5QrCode = null; 
        }
    }
}
