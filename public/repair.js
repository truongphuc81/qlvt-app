// public/repair.js

// === BIẾN TOÀN CỤC ===
let userEmail = '';
let userName = '';
let selectedPhotos = []; // Mảng chứa các File ảnh (Blob) đã nén
let checkPhotos = []; 
let repairPhotos = [];
let returnPhotos = [];
let currentTicketId = ''; // Lưu ID phiếu đang thao tác
let currentTicketData = null;
let ticketQrScanner = null;
let lastLoadedTicketId = null
let userRoles = {};
// === AUTH & INIT ===
document.addEventListener('DOMContentLoaded', function(){ 
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    
    // Sử dụng auth từ firebase đã khai báo trong HTML
    auth.onAuthStateChanged(user => {
        if (user) {
            userEmail = user.email;
            userName = user.displayName || user.email;
            if (authButton) authButton.style.display = 'none';
            if (signOutButton) signOutButton.style.display = 'inline-block';
            document.getElementById('app-container').style.display = 'block';
            callApi('/auth/getSelfRoles', {})
            .then(roles => {
                userRoles = roles; // Lưu quyền vào biến toàn cục
                console.log("User Roles:", userRoles);
                // Sau khi có quyền thì mới load ticket (hoặc load lại giao diện nếu cần)
            });
            showView('list');
            loadTickets();
        } else {
            if (authButton) {
                authButton.style.display = 'inline-block';
                authButton.onclick = signInWithGoogle; 
            }
            if (signOutButton) signOutButton.style.display = 'none';
            document.getElementById('app-container').style.display = 'none';
        }
    });
});

// === LOGIC GIAO DIỆN ===

// public/repair.js

function showView(viewName) {
    const listView = document.getElementById('listView');
    const createView = document.getElementById('createView');
    const detailView = document.getElementById('detailView');
    
    // Các nút trên Header
    const btnShowList = document.getElementById('btnShowList');
    const btnShowCreate = document.getElementById('btnShowCreate');

    // 1. Ẩn tất cả các view trước
    listView.style.display = 'none';
    createView.style.display = 'none';
    if (detailView) detailView.style.display = 'none';

    // 2. Xử lý hiển thị theo từng View
    if (viewName === 'list') {
        // --- ĐANG Ở DANH SÁCH ---
        listView.style.display = 'block';
        
        // Header: Hiện nút "+ Tạo Mới", Ẩn nút "Danh sách" (vì đang ở đây rồi)
        btnShowCreate.style.display = 'inline-block';
        btnShowList.style.display = 'none';
        
        loadTickets(); 
    } 
    else if (viewName === 'create') {
        // --- ĐANG TẠO MỚI ---
        createView.style.display = 'block';
        
        // Header: Ẩn HẾT nút điều hướng cho gọn
        // (Người dùng sẽ bấm nút "Hủy" ở cuối form để quay lại)
        btnShowCreate.style.display = 'none';
        btnShowList.style.display = 'none';
        
        resetCreateForm();
    } else if (viewName === 'detail') {
        // --- ĐANG XEM CHI TIẾT ---
        if (detailView) detailView.style.display = 'block';
        
        // Hiện nút Tạo Mới (để tạo nhanh)
        btnShowCreate.style.display = 'inline-block'; // <-- HIỆN LẠI
        
        // Vẫn ẩn nút Danh sách (để đỡ chật, dùng nút Quay lại ở dưới)
        btnShowList.style.display = 'none';
    }
}

function resetCreateForm() {
    // Xóa các ô input
    document.getElementById('custName').value = '';
    document.getElementById('custPhone').value = '';
    document.getElementById('custAddress').value = '';
    document.getElementById('deviceBrand').value = '';
    document.getElementById('deviceModel').value = '';
    document.getElementById('deviceSerial').value = '';
    document.getElementById('deviceAccessories').value = '';
    document.getElementById('customerDesc').value = '';
    document.getElementById('physicalDesc').value = '';
    document.getElementById('internalNote').value = '';
    
    // Reset checkbox
    document.querySelectorAll('.acc-check').forEach(cb => cb.checked = false);
    
    // Reset ảnh
    selectedPhotos = [];
    renderPhotoGrid();
}

// === LOGIC XỬ LÝ ẢNH (CLIENT-SIDE COMPRESSION) ===

function handlePhotoSelect(input) {
    const files = Array.from(input.files);
    if (files.length === 0) return;

    // Giới hạn tối đa 5 ảnh
    if (selectedPhotos.length + files.length > 5) {
        alert("Chỉ được phép tải lên tối đa 5 ảnh.");
        return;
    }

    files.forEach(file => {
        compressImage(file, 1024, 0.7).then(compressedBlob => {
            selectedPhotos.push(compressedBlob);
            renderPhotoGrid();
        }).catch(err => console.error("Lỗi nén ảnh:", err));
    });
    
    input.value = ''; // Reset input để chọn lại được file cũ nếu muốn
}

function renderPhotoGrid() {
    const grid = document.getElementById('photoPreviewGrid');
    grid.innerHTML = '';
    
    selectedPhotos.forEach((blob, index) => {
        const url = URL.createObjectURL(blob);
        const div = document.createElement('div');
        div.className = 'photo-item';
        div.innerHTML = `
            <img src="${url}">
            <button class="photo-remove" onclick="removePhoto(${index})">×</button>
        `;
        grid.appendChild(div);
    });
}

function removePhoto(index) {
    selectedPhotos.splice(index, 1);
    renderPhotoGrid();
}

/**
 * Hàm nén ảnh sử dụng Canvas
 * @param {File} file - File ảnh gốc
 * @param {number} maxWidth - Chiều rộng tối đa
 * @param {number} quality - Chất lượng (0.1 - 1.0)
 */
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // Tính tỷ lệ resize
                if (width > maxWidth) {
                    height = Math.round(height * maxWidth / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(blob => {
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

// === LOGIC GỬI PHIẾU (SUBMIT) ===

async function submitTicket(isPrint) {
    // 1. Validate
    const custName = document.getElementById('custName').value.trim();
    const custPhone = document.getElementById('custPhone').value.trim();
    const customerDesc = document.getElementById('customerDesc').value.trim();
    
    if (!custName || !custPhone || !customerDesc) {
        alert("Vui lòng nhập Tên khách, SĐT và Lỗi mô tả (*)");
        return;
    }

    const spinner = document.getElementById('createSpinner');
    spinner.style.display = 'block';

    try {
        // 2. Upload ảnh lên Firebase Storage
        const photoUrls = [];
        if (selectedPhotos.length > 0) {
            const storageRef = firebase.storage().ref();
            // Tạo tên file duy nhất
            const timestamp = Date.now();
            
            // Upload song song (Promise.all) cho nhanh
            const uploadPromises = selectedPhotos.map((blob, index) => {
                const fileName = `repair_photos/${timestamp}_${index}.jpg`;
                const fileRef = storageRef.child(fileName);
                return fileRef.put(blob).then(snapshot => snapshot.ref.getDownloadURL());
            });
            
            const urls = await Promise.all(uploadPromises);
            photoUrls.push(...urls);
        }

        // 3. Thu thập dữ liệu form
        const accessories = [];
        document.querySelectorAll('.acc-check:checked').forEach(cb => accessories.push(cb.value));
        const otherAcc = document.getElementById('deviceAccessories').value.trim();
        if (otherAcc) accessories.push(otherAcc);

        const ticketData = {
            creatorEmail: userEmail,
            creatorName: userName,
            
            customer: {
                name: custName,
                phone: custPhone,
                address: document.getElementById('custAddress').value.trim()
            },
            device: {
                type: document.getElementById('deviceType').value,
                brand: document.getElementById('deviceBrand').value.trim(),
                model: document.getElementById('deviceModel').value.trim(),
                serial: document.getElementById('deviceSerial').value.trim(),
                accessories: accessories
            },
            status: {
                current: 'Mới nhận',
                description: customerDesc,
                physicalCondition: document.getElementById('physicalDesc').value.trim(),
                internalNote: document.getElementById('internalNote').value.trim(),
                receiveDate: new Date().toISOString()
            },
            photos: photoUrls // Mảng chứa link ảnh
        };

        // 4. Gọi API Backend
        const result = await callApi('/repair/create', ticketData);
        
        alert(`Tạo phiếu thành công! Mã phiếu: ${result.ticketId}`);
        
        if (isPrint) {
            // Gọi hàm in (sẽ làm sau)
            console.log("Đang mở trang in cho: " + result.ticketId);
        }
        
        showView('list'); // Quay về danh sách

    } catch (error) {
        console.error("Lỗi tạo phiếu:", error);
        alert("Lỗi tạo phiếu: " + error.message);
    } finally {
        spinner.style.display = 'none';
    }
}

// Placeholder function cho List View
function loadTickets() {
    const tbody = document.getElementById('ticketTableBody');
    const statusFilter = document.getElementById('filterStatus').value;
    const searchText = document.getElementById('searchTicket').value.trim();

    tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner"></div> Đang tải dữ liệu...</td></tr>';
    
    callApi('/repair/list', { status: statusFilter, search: searchText })
        .then(tickets => {
            tbody.innerHTML = '';
            if (!tickets || tickets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">Không tìm thấy phiếu nào.</td></tr>';
                return;
            }

            tickets.forEach(t => {
                const tr = document.createElement('tr');
                
                // Màu sắc trạng thái
                let statusClass = 'status-new'; 
                if (t.currentStatus === 'Đang sửa') statusClass = 'status-warning'; 
                if (t.currentStatus === 'Hoàn tất' || t.currentStatus === 'Đã trả') statusClass = 'status-success';
                
                const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleString('vi-VN') : '';

                tr.innerHTML = `
                    <td style="font-weight:bold; color:var(--primary-color);">${t.ticketId}</td>
                    <td>
                        <div style="font-weight:600">${t.customerName}</div>
                        <div style="font-size:13px; color:#666">${t.customerPhone}</div>
                    </td>
                    
                    <td>
                        <div style="font-size: 14px; line-height: 1.4;">
                            <span class="mobile-label" style="display:none; color:#666;">Máy: </span>
                            
                            <span style="font-weight:600; color: #333;">
                                ${t.deviceType} - ${t.deviceBrand} ${t.deviceModel}
                            </span>
                        </div>
                        
                        <div class="ticket-sn" style="font-size:12px; color:#888; margin-top:2px;">
                            SN: ${t.deviceSerial}
                        </div>
                        
                        <div class="ticket-issue mobile-only-issue" style="margin-top:5px; font-size:13px; color:#c00; font-style:italic;">
                            <span class="mobile-label" style="display:none; color:#666; font-style:normal;">Lỗi: </span>
                            ${t.issueDescription || ''}
                        </div>
                    </td>
                    
                    <td><span class="badge ${statusClass}">${t.currentStatus}</span></td>
                    <td>${dateStr}</td>
                    <td>
                        <button class="btn-icon btn-view-detail" onclick="viewTicketDetail('${t.ticketId}')">
                            <span class="text-desktop">Xem</span>
                            <span class="text-mobile">Chi tiết</span>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="6" class="text-center error">Lỗi: ${err.message}</td></tr>`;
        });
        lastLoadedTicketId = null;
        fetchTicketsAPI(false);
}
function loadMoreTickets() {
    if (!lastLoadedTicketId) return;
    const btn = document.getElementById('loadMoreTickets');
    btn.innerText = 'Đang tải...';
    btn.disabled = true;
    
    fetchTicketsAPI(true); // true = tải thêm
}
/**
 * Hàm gọi API lấy danh sách phiếu (Dùng chung cho Tải mới và Tải thêm)
 */
function fetchTicketsAPI(isLoadMore) {
    const tbody = document.getElementById('ticketTableBody');
    const btnMore = document.getElementById('loadMoreTickets');
    const statusFilter = document.getElementById('filterStatus').value;
    const searchText = document.getElementById('searchTicket').value.trim();

    // 1. Xử lý giao diện trước khi gọi API
    if (!isLoadMore) {
        // Nếu là tải mới -> Xóa bảng và hiện loading
        tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner"></div> Đang tải dữ liệu...</td></tr>';
        if (btnMore) btnMore.style.display = 'none';
    } else {
        // Nếu là tải thêm -> Đổi trạng thái nút
        if (btnMore) {
            btnMore.innerText = 'Đang tải...';
            btnMore.disabled = true;
        }
    }

    // 2. Chuẩn bị dữ liệu gửi đi
    const payload = { 
        status: statusFilter, 
        search: searchText,
        lastTicketId: isLoadMore ? lastLoadedTicketId : null
    };

    // 3. Gọi API
    callApi('/repair/list', payload)
        .then(tickets => {
            // Xóa loading nếu là tải mới
            if (!isLoadMore) tbody.innerHTML = '';

            // Kiểm tra dữ liệu trả về
            if (!tickets || tickets.length === 0) {
                if (!isLoadMore) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Không tìm thấy phiếu nào.</td></tr>';
                }
                if (btnMore) btnMore.style.display = 'none';
                return;
            }

            // Cập nhật ID cuối cùng để lần sau tải tiếp
            lastLoadedTicketId = tickets[tickets.length - 1].ticketId;

            // Xử lý hiển thị nút Tải thêm (Nếu trả về ít hơn 20 -> Hết dữ liệu)
            if (btnMore) {
                if (tickets.length < 20) {
                    btnMore.style.display = 'none';
                } else {
                    btnMore.style.display = 'block';
                    btnMore.innerText = 'Tải thêm';
                    btnMore.disabled = false;
                }
            }

            // 4. Vẽ từng dòng phiếu
            tickets.forEach(t => {
                const tr = document.createElement('tr');
                
                // Màu sắc trạng thái
                let statusClass = 'status-new'; 
                if (t.currentStatus === 'Đang sửa') statusClass = 'status-warning'; 
                if (t.currentStatus === 'Hoàn tất' || t.currentStatus === 'Đã trả') statusClass = 'status-success';
                if (t.currentStatus === 'Trả máy không sửa') statusClass = 'status-danger';
                
                const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleString('vi-VN') : '';

                tr.innerHTML = `
                    <td style="font-weight:bold; color:var(--primary-color);">${t.ticketId}</td>
                    <td>
                        <div style="font-weight:600">${t.customerName}</div>
                        <div style="font-size:13px; color:#666">${t.customerPhone}</div>
                    </td>
                    
                    <td>
                        <div style="font-size: 11px; text-transform: uppercase; color: #666; font-weight: bold; margin-bottom: 2px;">
                            ${t.deviceType || 'THIẾT BỊ'}
                        </div>
                        <div style="margin-bottom: 2px;">
                            <span class="mobile-label" style="display:none; color:#666;">Máy: </span>
                            <span style="font-weight:600; color: #000;">${t.deviceBrand} ${t.deviceModel}</span>
                        </div>
                        <div class="ticket-sn" style="font-size:12px; color:#888; margin-top:2px;">
                            SN: ${t.deviceSerial || '---'}
                        </div>
                        <div class="ticket-issue mobile-only-issue" style="margin-top:5px; font-size:13px; color:#c00; font-style:italic;">
                            <span class="mobile-label" style="display:none; color:#666; font-style:normal;">Lỗi: </span>
                            ${t.issueDescription || ''}
                        </div>
                    </td>
                    
                    <td><span class="badge ${statusClass}">${t.currentStatus}</span></td>
                    <td>${dateStr}</td>
                    <td>
                        <button class="btn-icon btn-view-detail" onclick="viewTicketDetail('${t.ticketId}')">
                            <span class="text-desktop">Xem</span>
                            <span class="text-mobile">Chi tiết</span>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            console.error(err);
            if (!isLoadMore) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center error">Lỗi tải dữ liệu: ${err.message}</td></tr>`;
            } else {
                alert("Lỗi tải thêm: " + err.message);
                if (btnMore) {
                    btnMore.innerText = 'Tải thêm (Lỗi)';
                    btnMore.disabled = false;
                }
            }
        });
}
// Hàm xem chi tiết (Tạm thời)
function viewTicketDetail(ticketId) {
    currentTicketId = ticketId; // Lưu ID phiếu hiện tại để dùng cho các nút bấm
    showView('detail'); // Chuyển view
    
    // Hiển thị trạng thái đang tải
    document.getElementById('d_ticketId').innerText = ticketId;
    document.getElementById('d_custName').innerText = 'Đang tải...';
    
    // Gọi API lấy chi tiết
    callApi('/repair/detail', { ticketId: ticketId })
        .then(ticket => {
            currentTicketData = ticket;
            renderTicketDetail(ticket);
        })
        .catch(err => {
            console.error(err);
            alert("Lỗi tải chi tiết phiếu: " + err.message);
            showView('list'); // Quay về nếu lỗi
        });
}


function renderTicketDetail(t) {
    const isManager = userRoles.admin || userRoles.inventory_manager || userRoles.sale; // Cho phép Sale giao việc luôn nếu cần
    const myEmail = userEmail;
    // 1. Điền thông tin chung
    document.getElementById('d_ticketId').innerText = t.ticketId;
    document.getElementById('d_createdAt').innerText = new Date(t.createdAt).toLocaleString('vi-VN');
    
    // Khách hàng
    document.getElementById('d_custName').innerText = t.customerName;
    document.getElementById('d_custPhone').innerText = t.customerPhone;
    document.getElementById('d_custAddress').innerText = t.customerAddress || '---';
    
    // Thiết bị
    document.getElementById('d_deviceInfo').innerText = `${t.deviceType} - ${t.deviceBrand} ${t.deviceModel}`;
    document.getElementById('d_deviceSerial').innerText = t.deviceSerial || '---';
    const accStr = (t.accessories || []).join(', ');
    document.getElementById('d_accessories').innerText = accStr || 'Không có';
    
    // Tình trạng
    document.getElementById('d_issueDesc').innerText = t.issueDescription;
    document.getElementById('d_physicalDesc').innerText = t.physicalCondition || 'Bình thường';
    
    // Người nhận (Đã làm ở bước trước)
    if(document.getElementById('d_receiver')) {
        document.getElementById('d_receiver').innerText = t.creatorName || t.createdBy;
    }
    
    // 2. Hiển thị ảnh tiếp nhận
    const photoContainer = document.getElementById('d_receivePhotos');
    photoContainer.innerHTML = '';
    if (t.receivePhotos && t.receivePhotos.length > 0) {
        t.receivePhotos.forEach(url => {
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${url}" onclick="openImageModal('${url}')" style="cursor:pointer;" title="Bấm để phóng to">`; 
            photoContainer.appendChild(div);
        });
    } else {
        photoContainer.innerHTML = '<span style="font-size:12px; color:#999;">Không có ảnh</span>';
    }

    // Kiểm tra khóa
    const isTicketLocked = t.currentStatus === 'Hoàn tất' || t.currentStatus === 'Đã trả máy';

    // 3. KHỐI KỸ THUẬT KIỂM TRA
    const techBlock = document.getElementById('content_techCheck');
    const btnUpdateCheck = document.getElementById('btn_update_check');
    
    if (btnUpdateCheck) btnUpdateCheck.style.display = isTicketLocked ? 'none' : 'block';

    if (t.techCheck) {
        let techPhotosHtml = '';
        if (t.techCheck.photos && t.techCheck.photos.length > 0) {
            techPhotosHtml = `<div class="photo-grid" style="grid-template-columns: repeat(4, 1fr); margin-top:10px; border-top:1px dashed #ddd; padding-top:10px;">`;
            t.techCheck.photos.forEach(url => {
                techPhotosHtml += `<div class="photo-item"><img src="${url}" onclick="openImageModal('${url}')"></div>`;
            });
            techPhotosHtml += `</div>`;
        }

        techBlock.innerHTML = `
            <div style="background:#f9f9f9; padding:10px; border-radius:6px; border-left:4px solid var(--primary-color);">
                <div><strong>KTV:</strong> ${t.techCheck.technicianName || t.techCheck.technicianEmail}</div>
                
                <div style="margin-top:5px;"><strong>Nguyên nhân:</strong> ${t.techCheck.cause}</div>
                <div><strong>Đề xuất:</strong> ${t.techCheck.solution}</div>
                <div><strong>Linh kiện:</strong> ${t.techCheck.components || 'Không'}</div>
                ${techPhotosHtml} 
            </div>
        `;
    } else {
        // CHƯA CÓ KẾT QUẢ
        if (!isTicketLocked) {
            let assignHtml = '';
            
            if (t.assignedTechCheck) {
                // ĐÃ GIAO CHO AI ĐÓ
                const assignee = t.assignedTechCheck;
                const isMe = (assignee.email === myEmail);
                
                assignHtml = `
                    <div style="margin-bottom:10px; color:#0d47a1; background:#e3f2fd; padding:8px; border-radius:4px; border-left: 3px solid #2196f3;">
                        👤 KTV: <strong>${assignee.name}</strong><br>
                        <small style="color:#666;">Giao bởi ${assignee.assignedBy} lúc ${new Date(assignee.assignedAt).toLocaleString('vi-VN')}</small>
                    </div>
                `;

                // Nút cập nhật: Chỉ hiện cho Chính chủ hoặc Quản lý
                if (isMe || isManager) {
                    if (btnUpdateCheck) {
                        btnUpdateCheck.style.display = 'block';
                        btnUpdateCheck.innerText = '📝 Báo Cáo Kết Quả';
                    }
                }
                
                // Nút Giao lại (Chỉ Quản lý thấy)
                if (isManager) {
                     assignHtml += `
                        <div style="text-align:right; margin-bottom:5px;">
                            <button onclick="openAssignModal('CHECK')" style="background:none; border:none; color:#2196f3; cursor:pointer; font-size:12px; text-decoration:underline;">
                                🔄 Giao người khác
                            </button>
                        </div>`;
                }

            } else {
                // CHƯA GIAO -> Hiện nút Giao (Chỉ Quản lý)
                if (isManager) {
                    assignHtml = `
                        <div style="text-align:center; margin-bottom:10px;">
                            <button onclick="openAssignModal('CHECK')" class="btn-sm" style="background:#673ab7; padding:8px 15px;">
                                👉 Giao KTV Kiểm Tra
                            </button>
                        </div>
                    `;
                } else {
                    assignHtml = `<div style="color:#999; text-align:center; font-style:italic;">(Chưa phân công KTV)</div>`;
                }
            }

            techBlock.innerHTML = `
                ${assignHtml}
                <div style="color:#666; font-style:italic; text-align:center;">(Chờ kết quả kiểm tra...)</div>
            `;
        } else {
            techBlock.innerHTML = '<div style="color:#666;">(Không có dữ liệu kiểm tra)</div>';
        }
    }

    // --- KHỐI ĐIỀU PHỐI GỬI NGOÀI (LOGIC ĐÃ SỬA) ---
    const extContainer = document.getElementById('block_external_logistics');
    const extContent = document.getElementById('content_external_logistics');
    
    const techSol = t.techCheck ? t.techCheck.solution : '';
    const isKtvSuggestExternal = techSol === 'Gửi sửa ngoài' || techSol === 'Gửi hãng';
    const hasExternalLog = t.externalLogistics && t.externalLogistics.sentDate;

    if (isKtvSuggestExternal || hasExternalLog) {
        extContainer.style.display = 'block';
        
        const log = t.externalLogistics || {};
        const isWarranty = techSol === 'Gửi hãng' || (log.unitName && log.unitName.toLowerCase().includes('hãng'));
        const typeLabel = isWarranty ? 'Bảo Hành' : 'Sửa Ngoài';

        if (log.sentDate) {
            // ĐÃ GỬI ĐI
            
            // === SỬA LOGIC HIỂN THỊ ===
            if (log.receivedDate) {
                // TRƯỜNG HỢP 1: ĐÃ NHẬN VỀ
                extContent.innerHTML = `
                    <div style="font-size:13px;">
                        <div><strong>Đơn vị:</strong> ${log.unitName}</div>
                        <div style="color:#666;">Gửi: ${new Date(log.sentDate).toLocaleString('vi-VN')}</div>
                        <div style="margin-top:5px; color:#155724; font-weight:bold; background:#d4edda; padding:5px; border-radius:4px;">
                            ✅ Đã nhận về: ${new Date(log.receivedDate).toLocaleString('vi-VN')}
                        </div>
                        <div style="font-size:12px; margin-top:2px;">
                            QC: <strong>${log.qcResult}</strong> - ${log.qcNote}
                        </div>
                    </div>
                `;
            } else {
                // TRƯỜNG HỢP 2: VẪN ĐANG Ở ĐƠN VỊ NGOÀI
                extContent.innerHTML = `
                    <div style="font-size:13px;">
                        <div><strong>Đơn vị:</strong> ${log.unitName}</div>
                        <div><strong>Gửi lúc:</strong> ${new Date(log.sentDate).toLocaleString('vi-VN')}</div>
                        <div style="color:#666; font-style:italic;">"${log.note || ''}"</div>
                        <div style="margin-top:5px; color:#0d47a1; font-weight:bold;">
                            ⏳ Đang ở đơn vị xử lý...
                        </div>
                    </div>
                `;
            }
            // === KẾT THÚC SỬA ===
            
        } else {
            // CHƯA GỬI
            extContent.innerHTML = `
                <div style="text-align:center;">
                    <div style="margin-bottom:10px; color:#e65100;">Cần gửi máy đi để kiểm tra/báo giá</div>
                    <button onclick="openExternalModal('SEND')" class="btn-sm" style="background:#ff9800; padding:8px 20px; font-size:13px;">
                        🚚 Xác nhận Gửi đi ${typeLabel}
                    </button>
                </div>
            `;
        }
    } else {
        extContainer.style.display = 'none';
    }

    // --- CHUẨN BỊ BIẾN DÙNG CHUNG ---
    // const techSol = t.techCheck ? t.techCheck.solution : '';
    // const isKtvSuggestExternal = techSol === 'Gửi sửa ngoài' || techSol === 'Gửi hãng';
    // const hasExternalLog = t.externalLogistics && t.externalLogistics.sentDate;

    // ============================================================
    // 4. KHỐI BÁO GIÁ
    // ============================================================
    const quoteBlock = document.getElementById('content_quotation');
    const quoteContainer = document.getElementById('block_quotation');
    const btnUpdateQuote = document.getElementById('btn_update_quote');
    
    // 1. Kiểm tra Quyền hạn cơ bản
    const canUpdate = (userRoles.sale || userRoles.admin) && !isTicketLocked;

    // 2. Kiểm tra Điều kiện Quy trình (Workflow)
    // Nếu là Sửa ngoài -> Phải Gửi đi rồi (hasExternalLog) thì mới được Báo giá
    let isReadyToQuote = true;
    if (isKtvSuggestExternal && !hasExternalLog) {
        isReadyToQuote = false; 
    }

    if (t.quotation) {
        // --- TRƯỜNG HỢP A: ĐÃ CÓ BÁO GIÁ ---
        quoteContainer.style.opacity = '1';
        if(btnUpdateQuote) {
            // Nếu đã có báo giá, cho phép sửa (Cập nhật) miễn là có quyền
            btnUpdateQuote.style.display = canUpdate ? 'block' : 'none'; 
            btnUpdateQuote.innerText = 'Cập nhật';
        }
        
        let itemsHtml = '<table style="width:100%; font-size:13px; border-collapse: collapse;">';
        
        // Kiểm tra xem user có quyền xem Giá Gốc không
        const showCost = (userRoles.admin || userRoles.sale) && t.quotation.type === 'EXTERNAL';
        
        // Header bảng
        itemsHtml += `<tr style="background:#eee; border-bottom:1px solid #ccc;">
                        <th style="text-align:left; padding:4px;">Tên</th>
                        <th style="padding:4px;">SL</th>`;
        if (showCost) itemsHtml += `<th style="padding:4px; color:#e65100;">Vốn</th>`;
        itemsHtml += `<th style="padding:4px; text-align:right;">Giá</th></tr>`;

        let totalCost = t.quotation.externalInfo ? (t.quotation.externalInfo.shippingFee || 0) : 0;

        (t.quotation.items || []).forEach(item => {
            const priceStr = item.price.toLocaleString('vi-VN');
            const costStr = (item.cost || 0).toLocaleString('vi-VN');
            
            if(showCost) totalCost += (item.cost || 0) * item.qty;

            itemsHtml += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:4px;">${item.name}</td>
                    <td style="padding:4px; text-align:center;">${item.qty}</td>`;
            
            if (showCost) itemsHtml += `<td style="padding:4px; text-align:right; color:#e65100;">${costStr}</td>`;
            
            itemsHtml += `<td style="padding:4px; text-align:right; font-weight:500;">${priceStr}</td>
                </tr>`;
        });
        itemsHtml += '</table>';

        // Tính lợi nhuận
        let profitHtml = '';
        if (showCost) {
            const shipping = t.quotation.externalInfo.shippingFee || 0;
            const profit = t.quotation.totalPrice - totalCost;
            profitHtml = `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #aaa; font-size: 12px; color: #d84315;">
                    <strong>🔒 NỘI BỘ (Gửi: ${t.quotation.externalInfo.unit}):</strong><br>
                    Tổng Vốn: ${totalCost.toLocaleString('vi-VN')} (Ship: ${shipping.toLocaleString('vi-VN')}) <br>
                    Lợi Nhuận: <strong>${profit.toLocaleString('vi-VN')}</strong>
                </div>
            `;
        }
        let internalCostHtml = '';
        
        // Kiểm tra quyền và xem có phải phiếu gửi ngoài không
        if ((userRoles.admin || userRoles.sale) && t.quotation.type === 'EXTERNAL' && t.quotation.externalInfo) {
            const ext = t.quotation.externalInfo;
            const cost = (ext.costPrice || 0).toLocaleString('vi-VN');
            const ship = (ext.shippingFee || 0).toLocaleString('vi-VN');
            const profit = (ext.profit || 0).toLocaleString('vi-VN');
            
            internalCostHtml = `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #aaa; font-size: 12px; color: #d84315;">
                    <strong>🔒 NỘI BỘ (Gửi: ${ext.unit}):</strong><br>
                    Giá nhập: ${cost} + Ship: ${ship} + Lời: <strong>${profit}</strong>
                </div>
            `;
        }
        // ================================================
        const totalFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(t.quotation.totalPrice || 0);
        quoteBlock.innerHTML = `
            <div style="background:#fff3cd; padding:10px; border-radius:6px; border-left:4px solid #ffc107;">
                <div style="margin-bottom:8px;">${itemsHtml}</div>
                
                <div style="border-top:1px dashed #999; padding-top:5px; display:flex; justify-content:space-between; align-items:center;">
                    <strong>Tổng cộng:</strong>
                    <span style="font-size:1.2em; font-weight:bold; color:#d32f2f;">${totalFormatted}</span>
                </div>
                
                ${internalCostHtml}
                
                <div style="margin-top:5px; font-size:12px;">
                     <strong>BH:</strong> ${t.quotation.warranty || '---'} <br>
                     <em>${t.quotation.notes ? 'Ghi chú: ' + t.quotation.notes : ''}</em>
                </div>
                <div style="font-size:11px; color:#666; margin-top:5px; text-align:right;">
                    Sale: ${t.quotation.saleName}
                </div>
            </div>
        `;
    } else {
        // --- TRƯỜNG HỢP B: CHƯA CÓ BÁO GIÁ ---
        if (t.techCheck) {
            quoteContainer.style.opacity = '1';
            
            // Logic hiển thị nút "Lên Báo Giá"
            if (canUpdate) {
                if (isReadyToQuote) {
                    // Đủ điều kiện -> Hiện nút
                    if(btnUpdateQuote) {
                        btnUpdateQuote.style.display = 'block';
                        btnUpdateQuote.innerText = '➕ Lên Báo Giá';
                        btnUpdateQuote.style.backgroundColor = '#28a745';
                    }
                    quoteBlock.innerHTML = '<div style="color:#666; font-style:italic;">Chưa có báo giá.</div>';
                } else {
                    // Chưa đủ điều kiện (Chưa gửi máy) -> Ẩn nút, Báo lý do
                    if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
                    quoteBlock.innerHTML = '<div style="color:#e65100; font-style:italic;">⚠️ Vui lòng gửi máy đi sửa ngoài trước khi báo giá.</div>';
                }
            } else {
                // Không có quyền (KTV)
                if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
                quoteBlock.innerHTML = '<div style="color:#666; font-style:italic;">Chờ Phòng Kinh Doanh báo giá...</div>';
            }
        } else {
            // Chưa có kết quả kiểm tra
            quoteContainer.style.opacity = '0.6';
            if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
            quoteBlock.innerHTML = 'Đang chờ kỹ thuật kiểm tra...';
        }
    }

    // ============================================================
    // 5. KHỐI SỬA CHỮA (LOGIC TỔNG HỢP ĐẦY ĐỦ)
    // ============================================================
    const repairBlock = document.getElementById('content_repair');
    const repairContainer = document.getElementById('block_repair');
    
    // Quyền đặt hàng / gửi đi (Sale hoặc Admin hoặc Manager)
    const canOrder = userRoles.sale || userRoles.admin || userRoles.inventory_manager;

    if (t.currentStatus === 'Chờ khách xác nhận') {
        // --- TRƯỜNG HỢP 1: CHỜ KHÁCH ---
        repairContainer.style.opacity = '1';
        repairBlock.innerHTML = `
            <div style="background:#e8f5e9; padding:15px; border-radius:6px; text-align:center; border: 1px dashed #4caf50;">
                <h4 style="margin-top:0; color:#2e7d32;">⏳ Đang chờ khách chốt phương án...</h4>
                <div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">
                    <button onclick="confirmCustomerChoice(true)" style="background:#28a745; padding:8px 20px;">✅ Khách Đồng Ý</button>
                    <button onclick="confirmCustomerChoice(false)" style="background:#dc3545; padding:8px 20px;">❌ Khách Không Sửa</button>
                </div>
            </div>
        `;

    } else if (t.currentStatus === 'Chờ đặt hàng') {
        // --- TRƯỜNG HỢP 2: ĐANG ĐỢI LINH KIỆN ---
        repairContainer.style.opacity = '1';
        const orderInfo = t.partOrder || {};
        
        // Nút xác nhận hàng về (Cho Sale/Admin/Kho)
        let arriveBtn = '';
        if (canOrder) {
            arriveBtn = `
                <button onclick="triggerPartsArrived()" class="btn-sm" style="background:#17a2b8; padding:10px 20px; margin-top:10px;">
                    📦 Xác nhận Đã Có Hàng
                </button>`;
        }

        repairBlock.innerHTML = `
            <div style="text-align:center; padding:15px; border:2px dashed #f57c00; background:#fff3e0; border-radius:8px;">
                <h4 style="margin-top:0; color:#e65100;">🚚 Đang chờ đặt linh kiện...</h4>
                <div style="font-size:13px; margin-bottom:5px; color:#333;">
                    Người đặt: <strong>${orderInfo.orderBy}</strong> - ${new Date(orderInfo.orderDate).toLocaleString('vi-VN')}
                </div>
                <div style="font-style:italic; color:#666;">"${orderInfo.note}"</div>
                ${arriveBtn}
            </div>
        `;

    } else if (t.currentStatus === 'Đã có hàng') {
        // --- TRƯỜNG HỢP 3: HÀNG ĐÃ VỀ -> KTV SỬA ---
        repairContainer.style.opacity = '1';
        const orderInfo = t.partOrder || {};

        repairBlock.innerHTML = `
            <div style="text-align:center; padding:15px; border:2px solid #28a745; background:#e8f5e9; border-radius:8px;">
                <h4 style="margin-top:0; color:#2e7d32;">✅ Linh kiện đã về!</h4>
                <div style="font-size:12px; margin-bottom:10px; color:#555;">
                    Về lúc: ${new Date(orderInfo.arriveDate).toLocaleString('vi-VN')}
                </div>
                <button onclick="openUpdateModal('repair')" class="btn-sm" style="background:#007bff; padding:10px 20px; font-size:14px;">
                    🔧 Tiến hành Sửa & Báo cáo
                </button>
            </div>
        `;

    } else if (t.currentStatus === 'Đang sửa' || t.currentStatus === 'Đang sửa ngoài') {
        // --- TRƯỜNG HỢP 4: ĐANG XỬ LÝ (Sửa trong hoặc Gửi ngoài) ---
        repairContainer.style.opacity = '1';
        let confirmInfo = '';
        if (t.customerConfirm) {
            confirmInfo = `<div style="margin-bottom:10px; font-style:italic;">Khách đã chốt: ${t.customerConfirm.result} (${new Date(t.customerConfirm.date).toLocaleString('vi-VN')})</div>`;
        }

        // Xác định lại thông tin Gửi ngoài / Bảo hành
        const techSolution = t.techCheck ? t.techCheck.solution : '';
        let unitName = t.quotation && t.quotation.externalInfo ? t.quotation.externalInfo.unit : '';
        
        // Nhận diện Bảo hành
        const isWarranty = (techSolution === 'Gửi hãng') || 
                           (unitName && unitName.toLowerCase().includes('hãng')) || 
                           (unitName && unitName.toLowerCase().includes('bảo hành'));

        // === KHAI BÁO CÁC BIẾN MÀ BẠN ĐANG BỊ THIẾU ===
        const labelAction = isWarranty ? 'Gửi đi Bảo Hành' : 'Gửi đi Sửa Ngoài';
        const labelStatus = isWarranty ? 'Máy đang được Bảo Hành' : 'Máy đang ở đơn vị ngoài';
        const colorStyle  = isWarranty ? '#17a2b8' : '#ff9800'; 
        const bgStyle     = isWarranty ? '#e0f7fa' : '#fff3e0';
        // ===============================================

        // Kiểm tra xem là Sửa ngoài hay Sửa trong
        const isExternal = t.quotation && t.quotation.type === 'EXTERNAL';
        // (Biến isKtvSuggestExternal đã được khai báo ở đầu hàm renderTicketDetail rồi)

        if (isExternal || isKtvSuggestExternal) {
            // === A. LOGIC SỬA NGOÀI ===
            
            if (t.currentStatus === 'Đang sửa ngoài') {
                // B. Đã gửi đi
                const log = t.externalLogistics || {};
                
                // Kiểm tra xem khách có hủy không để hiện màu cảnh báo
                const confirm = t.customerConfirm;
                const isDeclined = confirm && (confirm.result.includes('Không sửa') || confirm.result.includes('Từ chối'));
                
                let statusTitle = `⏳ ${labelStatus}...`;
                let boxStyle = `border:2px solid ${colorStyle}; background:${bgStyle};`;
                
                if (isDeclined) {
                    statusTitle = `⚠️ KHÁCH ĐÃ HỦY - CẦN RÚT MÁY VỀ`;
                    boxStyle = `border:2px solid #dc3545; background:#fff5f5;`; // Màu đỏ cảnh báo
                }

                repairBlock.innerHTML = `
                    ${confirmInfo}
                    <div style="text-align:center; padding:15px; ${boxStyle} border-radius:8px;">
                        <h4 style="margin-top:0; color:${isDeclined ? '#dc3545' : colorStyle};">${statusTitle}</h4>
                        <div style="font-size:13px; margin-bottom:10px;">
                            Gửi lúc: ${log.sentDate ? new Date(log.sentDate).toLocaleString('vi-VN') : '---'}<br>
                            Nơi nhận: <strong>${log.unitName}</strong>
                        </div>
                        <button onclick="openExternalModal('RECEIVE')" class="btn-sm" style="background:#28a745; padding:10px 20px;">
                            ✅ Đã Nhận Về & Test OK
                        </button>
                    </div>
                `;
            } else {
                // A. Chưa gửi (Đã xử lý ở khối Logistics trên rồi)
                if (!unitName) unitName = 'Đối tác / Hãng';
                
                repairBlock.innerHTML = `
                    ${confirmInfo}
                    <div style="text-align:center; padding:15px; border:2px dashed ${colorStyle}; background:${bgStyle}; border-radius:8px;">
                        <h4 style="margin-top:0; color:${colorStyle};">🚚 Cần ${labelAction}</h4>
                        <div style="margin-bottom:10px;">(Vui lòng thực hiện ở khối Điều phối bên trên)</div>
                    </div>
                `;
            }
        } else {
            // === B. LOGIC SỬA TẠI CHỖ (CẬP NHẬT GIAO VIỆC) ===
            
            let workerHtml = '';
            if (t.assignedRepair) {
                // Đã giao
                const assignee = t.assignedRepair;
                const isMe = (assignee.email === myEmail);
                
                workerHtml = `
                    <div style="margin-bottom:10px; font-size:13px; color:#004085; background:#cce5ff; padding:5px; border-radius:4px; border-left: 3px solid #007bff;">
                        🔧 KTV: <strong>${assignee.name}</strong> đang sửa
                    </div>
                `;
                
                // Nếu là Chính chủ hoặc Quản lý -> Hiện nút Hoàn tất
                // (Lưu ý: Nút Hoàn tất nằm sẵn trong HTML string bên dưới, ta chỉ cần không ẩn nó đi là được)
                
                if (isManager) {
                     workerHtml += `
                        <div style="text-align:right; margin-bottom:5px;">
                            <button onclick="openAssignModal('REPAIR')" style="background:none; border:none; color:#007bff; cursor:pointer; font-size:12px; text-decoration:underline;">
                                🔄 Giao người khác
                            </button>
                        </div>`;
                }

            } else {
                // Chưa giao
                if (isManager) {
                    workerHtml = `
                        <div style="margin-bottom:10px;">
                            <button onclick="openAssignModal('REPAIR')" class="btn-sm" style="background:#673ab7;">👉 Giao KTV Sửa Chữa</button>
                        </div>
                    `;
                }
            }
            
            // Chỉ hiện nút Báo cáo hoàn tất nếu Đã giao cho Mình hoặc là Quản lý
            // Nếu chưa giao ai -> Ẩn nút hoàn tất (để ép phải giao trước)
            const showCompleteBtn = (t.assignedRepair && (t.assignedRepair.email === myEmail || isManager));
            const completeBtnHtml = showCompleteBtn 
                ? `<button onclick="openUpdateModal('repair')" class="btn-sm" style="background:#007bff; padding:10px 20px; font-size:14px;">✅ Báo Cáo Hoàn Tất</button>`
                : `<span style="font-size:12px; color:#999;">(Cần giao việc để báo cáo)</span>`;

            repairBlock.innerHTML = `
                ${confirmInfo}
                <div style="text-align:center; padding:15px; border:2px dashed #ffc107; background:#fff3cd; border-radius:8px;">
                    <h4 style="margin-top:0; color:#856404;">🔧 Đang tiến hành sửa chữa...</h4>
                    ${workerHtml}
                    ${completeBtnHtml}
                    ${orderBtn}
                </div>
            `;
        }

    } else if (t.repair) {
        // --- TRƯỜNG HỢP 5: ĐÃ SỬA XONG (Dữ liệu đã có) ---
        repairContainer.style.opacity = '1';
        
        // Hiển thị ảnh (nếu có)
        let photosHtml = '';
        if (t.repair.photos && t.repair.photos.length > 0) {
            photosHtml = `<div class="photo-grid" style="grid-template-columns: repeat(4, 1fr); margin-top:10px;">`;
            t.repair.photos.forEach(url => {
                photosHtml += `<div class="photo-item"><img src="${url}" onclick="openImageModal('${url}')" style="cursor:pointer;"></div>`;
            });
            photosHtml += `</div>`;
        }

        repairBlock.innerHTML = `
            <div style="background:#d4edda; padding:10px; border-radius:6px; border-left:4px solid #28a745;">
                <div style="color:#155724; font-weight:bold; margin-bottom:5px;">✅ Đã sửa xong</div>
                <div><strong>KTV:</strong> ${t.repair.technicianName || t.repair.technicianEmail}</div>
                <div><strong>Công việc:</strong> ${t.repair.workDescription}</div>
                <div><strong>Bảo hành:</strong> ${t.repair.warranty || 'Không'}</div>
                ${photosHtml}
                <div style="font-size:11px; color:#666; margin-top:5px; text-align:right;">
                    ${new Date(t.repair.completionDate).toLocaleString('vi-VN')}
                </div>
            </div>
        `;

    } else if (t.currentStatus === 'Trả máy không sửa') {
        // --- TRƯỜNG HỢP 6: KHÁCH HỦY ---
        repairContainer.style.opacity = '1';
        repairBlock.innerHTML = `<div style="background:#f8d7da; color:#721c24; padding:10px; border-radius:6px; text-align:center;">❌ Khách không sửa. Chuyển sang trả máy.</div>`;

    } else {
        // --- CHƯA ĐẾN BƯỚC NÀY ---
        repairContainer.style.opacity = '0.6';
        repairBlock.innerHTML = '---';
    }

    // 6. KHỐI TRẢ MÁY & THANH TOÁN
    let paymentContainer = document.getElementById('block_payment');
    if (!paymentContainer) {
        const rightPanel = document.querySelector('#detailView .right-panel');
        paymentContainer = document.createElement('div');
        paymentContainer.id = 'block_payment';
        paymentContainer.className = 'control-group';
        paymentContainer.style.opacity = '0.6';
        paymentContainer.innerHTML = '<h4>🧾 Thanh Toán & Trả Máy</h4><div id="content_payment">---</div>';
        rightPanel.appendChild(paymentContainer);
    }
    const paymentBlock = document.getElementById('content_payment');

    if ((t.currentStatus === 'Hoàn tất' || t.currentStatus === 'Đã trả') && t.payment) {
        paymentContainer.style.opacity = '1';
        const amount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(t.payment.totalAmount);
        
        let photosHtml = '';
        if (t.payment.photos && t.payment.photos.length > 0) {
            photosHtml = `<div class="photo-grid" style="grid-template-columns: repeat(4, 1fr); margin-top:10px;">`;
            t.payment.photos.forEach(url => {
                photosHtml += `<div class="photo-item"><img src="${url}" onclick="openImageModal('${url}')"></div>`;
            });
            photosHtml += `</div>`;
        }

        paymentBlock.innerHTML = `
            <div style="background:#e8f5e9; padding:10px; border-radius:6px; border-left:4px solid #2e7d32;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <span style="font-weight:bold; color:#1b5e20;">ĐÃ THU TIỀN:</span>
                    <span style="font-weight:bold; font-size:1.2em; color:#d32f2f;">${amount}</span>
                </div>
                <div><strong>Hình thức:</strong> ${t.payment.method}</div>
                <div><strong>Số sổ 3 liên:</strong> ${t.payment.ticketNumber}</div>
                <div><strong>Ghi chú:</strong> ${t.payment.note || 'Không'}</div>
                ${photosHtml}
                <div style="font-size:11px; color:#666; margin-top:5px; text-align:right;">
                    Thu ngân: ${t.payment.staffName || t.payment.staffEmail} - ${new Date(t.payment.date).toLocaleString('vi-VN')}
                </div>
            </div>
        `;
        
    } else if (t.currentStatus === 'Chờ trả máy' || t.currentStatus === 'Trả máy không sửa') {
        paymentContainer.style.opacity = '1';
        paymentBlock.innerHTML = `
            <div style="text-align:center; padding:15px; border:2px dashed #28a745; background:#f1f8e9; border-radius:8px;">
                <h4 style="margin-top:0; color:#2e7d32;">🏁 Máy đã sẵn sàng trả khách</h4>
                <button onclick="openUpdateModal('return')" class="btn-sm" style="background:#28a745; padding:10px 20px; font-size:14px;">💸 Thu Tiền & Trả Máy</button>
            </div>
        `;
    } else {
        paymentContainer.style.opacity = '0.6';
        paymentBlock.innerHTML = '---';
    }

    updateTimeline(t.currentStatus);
}

function updateTimeline(status) {
    // Reset active
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    
    // Logic map status với step ID
    // (Tạm thời logic đơn giản, sau này sẽ phức tạp hơn)
    const steps = ['step_new', 'step_check', 'step_quote', 'step_repair', 'step_done'];
    let activeIndex = 0;
    
    if (status === 'Mới nhận') activeIndex = 0;
    else if (status === 'Đang kiểm tra' || status === 'Chờ báo giá') activeIndex = 1;
    else if (status === 'Đã báo giá' || status === 'Chờ khách duyệt' || status === 'Chờ khách xác nhận') activeIndex = 2;
    else if (status === 'Đang sửa' || status === 'Chờ sửa chữa' || status === 'Chờ đặt hàng' || status === 'Đã có hàng') {
        activeIndex = 3; // Bước 4
    }
    else if (status === 'Hoàn tất' || status === 'Đã trả' || status === 'Chờ trả máy') activeIndex = 4;
    
    // Active tất cả các bước từ đầu đến bước hiện tại
    for (let i = 0; i <= activeIndex; i++) {
        const stepEl = document.getElementById(steps[i]);
        if(stepEl) stepEl.classList.add('active');
    }
}
// --- CÁC HÀM MODAL ---

function openUpdateModal(type) {
    // Lưu ID phiếu đang xem
    currentTicketId = document.getElementById('d_ticketId').innerText;
    
    if (type === 'check') {
        // Reset form
        document.getElementById('check_cause').value = '';
        document.getElementById('check_components').value = '';
        checkPhotos = [];
        document.getElementById('checkPhotoGrid').innerHTML = '';
        
        // Mở Modal
        document.getElementById('modalTechCheck').style.display = 'flex';
    }
    else if (type === 'quote') {
        const techInfo = document.getElementById('content_techCheck').innerText;
        document.getElementById('quote_tech_summary').innerText = techInfo || 'Chưa có thông tin';

        // Xóa trắng bảng cũ
        document.getElementById('quoteItemsBody').innerHTML = '';
        
        const techSolution = currentTicketData.techCheck ? currentTicketData.techCheck.solution : '';

        // === LOGIC 1: TỰ ĐỘNG ĐIỀN CHO CA "KHÔNG SỬA ĐƯỢC" ===
        if (techSolution === 'Không sửa được') {
            // Tự động chọn Sửa tại chỗ (Internal)
            document.querySelector('input[name="quoteType"][value="INTERNAL"]').checked = true;
            toggleQuoteType();
            
            // Thêm dòng phí kiểm tra (mặc định 0đ, có thể sửa tay)
            addQuoteRow("Phí kiểm tra (Trả máy không sửa)", 1, 0);
            
            document.getElementById('quote_warranty').value = 'Không';
            document.getElementById('quote_notes').value = 'Máy không sửa được, gửi lại khách.';
            
        } else {
            // === LOGIC 2: CA SỬA ĐƯỢC (Nội bộ hoặc Gửi ngoài) ===
            const radioExternal = document.querySelector('input[name="quoteType"][value="EXTERNAL"]');
            const radioInternal = document.querySelector('input[name="quoteType"][value="INTERNAL"]');

            // Tự động chọn loại hình dựa trên đề xuất của KTV
            if (techSolution === 'Gửi sửa ngoài' || techSolution === 'Gửi hãng') {
                 radioExternal.checked = true;
                 if (currentTicketData.externalLogistics && currentTicketData.externalLogistics.unitName) {
                        // Chờ toggle xong mới điền được
                        setTimeout(() => {
                            document.getElementById('q_ext_unit').value = currentTicketData.externalLogistics.unitName;
                        }, 0);
                    }
                } else {
                 radioInternal.checked = true;
            }
            toggleQuoteType(); // Cập nhật giao diện ngay lập tức

            // KIỂM TRA: Nếu đã có báo giá cũ -> Điền lại dữ liệu (Chế độ Sửa)
            if (currentTicketData && currentTicketData.quotation) {
                const q = currentTicketData.quotation;
                
                // Khôi phục Loại báo giá đã lưu (ghi đè logic tự động ở trên)
                if (q.type === 'EXTERNAL') {
                     radioExternal.checked = true;
                } else {
                     radioInternal.checked = true;
                }
                toggleQuoteType(); // Cập nhật lại giao diện theo dữ liệu đã lưu
                
                // Khôi phục danh sách linh kiện vào bảng
                if (q.items && q.items.length > 0) {
                q.items.forEach(item => {
                    // Truyền thêm tham số cost vào
                    addQuoteRow(item.name, item.qty, item.price, item.cost);
                });
                } else {
                    addQuoteRow(); 
                }

                // Khôi phục thông tin khác
                document.getElementById('quote_warranty').value = q.warranty || '';
                document.getElementById('quote_notes').value = q.notes || '';
                
                // Khôi phục thông tin Giá vốn (nếu là Gửi ngoài)
                if (q.externalInfo) {
                    document.getElementById('q_ext_unit').value = q.externalInfo.unit || '';
                    document.getElementById('q_ext_ship').value = q.externalInfo.shippingFee || '';
                }
            } else {
                // Nếu chưa có báo giá -> Tạo form mới sạch sẽ
                addQuoteRow(); // Tạo 1 dòng trống mặc định (có placeholder)
                document.getElementById('quote_warranty').value = '';
                document.getElementById('quote_notes').value = '';
                
                // Reset form giá vốn
                document.getElementById('q_ext_unit').value = '';
                
                document.getElementById('q_ext_ship').value = '';
                
            }
        }
        // ======================================================

        calculateQuoteTotal(); // Tính tổng tiền lần đầu
        document.getElementById('modalQuote').style.display = 'flex'; // Hiện Modal
    }
    else if (type === 'repair') {
        document.getElementById('repair_work').value = '';
        // Tự động điền bảo hành từ báo giá (nếu có)
        if (currentTicketData && currentTicketData.quotation) {
            document.getElementById('repair_warranty').value = currentTicketData.quotation.warranty || '';
        }
        
        repairPhotos = [];
        document.getElementById('repairPhotoGrid').innerHTML = '';
        
        document.getElementById('modalRepair').style.display = 'flex';
    }
    else if (type === 'return') {
        let finalPrice = 0;

        // === SỬA LOGIC MỚI: KIỂM TRA QUYẾT ĐỊNH CỦA KHÁCH ===
        // Chỉ lấy giá từ báo giá nếu khách ĐÃ CHỐT LÀ "ĐỒNG Ý SỬA"
        // Các trường hợp: "Không sửa", "Đồng ý nhận lại máy"... đều coi là 0đ
        
        const confirm = currentTicketData.customerConfirm;
        const isAgreedToRepair = confirm && confirm.result === 'Đồng ý sửa';

        if (isAgreedToRepair && currentTicketData.quotation) {
            finalPrice = currentTicketData.quotation.totalPrice || currentTicketData.quotation.price || 0;
        }
        // ====================================================
        
        // Hiển thị giá gợi ý
        const priceEl = document.getElementById('return_quote_price');
        priceEl.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(finalPrice);
        priceEl.style.color = finalPrice > 0 ? '#2e7d32' : '#d32f2f'; 
        
        // Điền vào ô thực thu
        document.getElementById('return_amount').value = finalPrice;
        
        // Reset các ô khác
        document.getElementById('return_ticket_number').value = '';
        document.getElementById('return_note').value = '';
        
        returnPhotos = [];
        document.getElementById('returnPhotoGrid').innerHTML = '';
        
        document.getElementById('modalReturn').style.display = 'flex';
    }
}
async function submitQuote() {
    const items = [];
    const quoteType = document.querySelector('input[name="quoteType"]:checked').value;
// Lấy nút bấm để tạo hiệu ứng loading
    const btn = document.querySelector('#modalQuote button[onclick="submitQuote()"]');
    const originalText = btn ? btn.innerText : 'Gửi Báo Giá';

    document.querySelectorAll('#quoteItemsBody tr').forEach(tr => {
        const name = tr.querySelector('.q-name').value.trim();
        const qty = parseFloat(tr.querySelector('.q-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.q-price').value) || 0;
        const cost = parseFloat(tr.querySelector('.q-cost').value) || 0;

        if (name) {
            // Luôn lưu cả cost và price
            items.push({ name, qty, price, cost });
        }
    });

    if (items.length === 0) {
        alert("Vui lòng nhập ít nhất 1 linh kiện/dịch vụ.");
        return;
    }

    const totalPrice = calculateQuoteTotal();
    const warranty = document.getElementById('quote_warranty').value.trim();
    const notes = document.getElementById('quote_notes').value.trim();
    // Lấy thêm thông tin Gửi ngoài
    let externalData = null;

    if (quoteType === 'EXTERNAL') {
        externalData = {
            unit: document.getElementById('q_ext_unit').value.trim(),
            shippingFee: parseFloat(document.getElementById('q_ext_ship').value) || 0
        };
    }

    const data = {
        ticketId: currentTicketId,
        action: 'SALE_QUOTE',
        data: {
            items: items,
            totalPrice: calculateQuoteTotal(),
            warranty: document.getElementById('quote_warranty').value.trim(),
            notes: document.getElementById('quote_notes').value.trim(),
            quoteType: quoteType,
            externalInfo: externalData
        }
    };
    
    // === BẮT ĐẦU LOADING ===
    btn.disabled = true;
    btn.innerText = '⏳ Đang gửi...';

    callApi('/repair/update', data)
        .then(() => {
            alert("Đã gửi báo giá thành công!");
            closeModal('modalQuote');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => { 
            // === KẾT THÚC LOADING ===
            btn.disabled = false;
            btn.innerText = originalText;
        });
}
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Xử lý ảnh cho Modal Kiểm tra (Tương tự ảnh lúc tạo)
function handleCheckPhotoSelect(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        compressImage(file, 1024, 0.7).then(blob => {
            checkPhotos.push(blob);
            // Render preview
            const url = URL.createObjectURL(blob);
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${url}">`; // Tạm thời chưa làm nút xóa cho nhanh
            document.getElementById('checkPhotoGrid').appendChild(div);
        });
    });
    input.value = '';
}

// --- GỬI KẾT QUẢ KIỂM TRA ---

async function submitTechCheck() {
    const cause = document.getElementById('check_cause').value.trim();
    const solution = document.getElementById('check_solution').value;
    const components = document.getElementById('check_components').value.trim();
    
    // Lấy nút bấm để xử lý spinner
    const btn = document.querySelector('#modalTechCheck button[onclick="submitTechCheck()"]');
    const originalText = btn.innerText;

    if (!cause) {
        alert("Vui lòng nhập nguyên nhân lỗi.");
        return;
    }

    // === BẮT ĐẦU LOADING ===
    btn.disabled = true;
    btn.innerText = '⏳ Đang lưu...';

    try {
        // 1. Upload ảnh
        let photoUrls = [];
        if (checkPhotos.length > 0) {
            const storageRef = firebase.storage().ref();
            const timestamp = Date.now();
            const uploadPromises = checkPhotos.map((blob, index) => {
                const fileName = `repair_photos/${currentTicketId}_check_${timestamp}_${index}.jpg`;
                return storageRef.child(fileName).put(blob).then(s => s.ref.getDownloadURL());
            });
            photoUrls = await Promise.all(uploadPromises);
        }

        // 2. Gọi API
        const data = {
            ticketId: currentTicketId,
            action: 'TECH_CHECK',
            data: {
                cause: cause,
                solution: solution,
                components: components,
                photos: photoUrls
            }
        };
        
        await callApi('/repair/update', data);
        
        alert("Cập nhật kiểm tra thành công!");
        closeModal('modalTechCheck');
        viewTicketDetail(currentTicketId);

    } catch (err) {
        console.error(err);
        alert("Lỗi: " + err.message);
    } finally {
        // === KẾT THÚC LOADING ===
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
// public/repair.js - Logic Bảng Báo Giá

function addQuoteRow(name = '', qty = null, price = null, cost = null) { // Thêm tham số cost
    const tbody = document.getElementById('quoteItemsBody');
    const tr = document.createElement('tr');
    
    const valQty = (qty !== null) ? qty : '';
    const valPrice = (price !== null) ? price : '';
    const valCost = (cost !== null) ? cost : ''; // Giá gốc

    tr.innerHTML = `
        <td>
            <input type="text" class="q-name" value="${name}" placeholder="Tên linh kiện/DV" style="width:100%; margin:0;">
        </td>
        <td>
            <input type="number" class="q-qty" value="${valQty}" min="1" placeholder="SL" oninput="calculateQuoteTotal()" style="width:100%; margin:0; text-align:center;">
        </td>
        <td class="ext-only">
            <input type="number" class="q-cost" value="${valCost}" min="0" step="1000" placeholder="Giá nhập" oninput="calculateQuoteTotal()" style="width:100%; margin:0; text-align:right; background:#fff3e0;">
        </td>
        <td>
            <input type="number" class="q-price" value="${valPrice}" min="0" step="1000" placeholder="Giá bán" oninput="calculateQuoteTotal()" style="width:100%; margin:0; text-align:right; font-weight:bold;">
        </td>
        <td style="text-align: center; vertical-align: middle;">
            <button onclick="this.closest('tr').remove(); calculateQuoteTotal();" style="background:none; border:none; color:#dc3545; cursor:pointer; font-size: 16px; padding: 5px;">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    calculateQuoteTotal();
}

function calculateQuoteTotal() {
    let totalSales = 0;
    let totalCost = 0;

    document.querySelectorAll('#quoteItemsBody tr').forEach(tr => {
        const qty = parseFloat(tr.querySelector('.q-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.q-price').value) || 0;
        const cost = parseFloat(tr.querySelector('.q-cost').value) || 0;
        
        totalSales += qty * price;
        totalCost += qty * cost;
    });
    
    // Cộng thêm phí vận chuyển vào Tổng giá vốn
    const shippingFee = parseFloat(document.getElementById('q_ext_ship').value) || 0;
    totalCost += shippingFee;

    const profit = totalSales - totalCost;

    // Hiển thị
    document.getElementById('quote_total_display').innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalSales);
    document.getElementById('quote_profit_display').innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(profit);

    return totalSales;
}
// --- LOGIC XEM ẢNH LIGHTBOX ---
function openImageModal(src) {
    const modal = document.getElementById('imageViewerModal');
    const modalImg = document.getElementById('imgExpanded');
    
    modal.style.display = "flex"; // Dùng flex để căn giữa
    modalImg.src = src;
}

function closeImageModal() {
    document.getElementById('imageViewerModal').style.display = "none";
}
/**
 * Xử lý khi Khách chốt (Đồng ý hoặc Hủy)
 */
async function confirmCustomerChoice(isAgreed) {
    const actionName = isAgreed ? "ĐỒNG Ý SỬA" : "KHÔNG SỬA (Trả máy)";
    const note = prompt(`Bạn xác nhận khách ${actionName}?\nNhập ghi chú (nếu có):`);
    
    if (note === null) return; // Bấm Cancel thì thôi

    const data = {
        ticketId: currentTicketId,
        action: 'CUSTOMER_CONFIRM',
        data: {
            isAgreed: isAgreed,
            note: note || ''
        }
    };

    // Hiển thị loading (tận dụng spinner cũ)
    const spinner = document.getElementById('createSpinner');
    if(spinner) spinner.style.display = 'block';

    callApi('/repair/update', data)
        .then(() => {
            alert("Đã cập nhật trạng thái: " + actionName);
            viewTicketDetail(currentTicketId); // Tải lại
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => { if(spinner) spinner.style.display = 'none'; });
}
// Xử lý ảnh sửa chữa
function handleRepairPhotoSelect(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        compressImage(file, 1024, 0.7).then(blob => {
            repairPhotos.push(blob);
            const url = URL.createObjectURL(blob);
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${url}">`;
            document.getElementById('repairPhotoGrid').appendChild(div);
        });
    });
    input.value = '';
}
async function submitRepairComplete() {
    const work = document.getElementById('repair_work').value.trim();
    const warranty = document.getElementById('repair_warranty').value.trim();
    
    // Lấy nút bấm
    const btn = document.querySelector('#modalRepair button[onclick="submitRepairComplete()"]');
    const originalText = btn.innerText;

    if (!work) {
        alert("Vui lòng nhập nội dung công việc đã làm.");
        return;
    }

    // === BẮT ĐẦU LOADING ===
    btn.disabled = true;
    btn.innerText = '⏳ Đang xử lý...';

    try {
        // Upload ảnh
        let photoUrls = [];
        if (repairPhotos.length > 0) {
            const storageRef = firebase.storage().ref();
            const timestamp = Date.now();
            const uploadPromises = repairPhotos.map((blob, index) => {
                const fileName = `repair_photos/${currentTicketId}_repair_${timestamp}_${index}.jpg`;
                return storageRef.child(fileName).put(blob).then(s => s.ref.getDownloadURL());
            });
            photoUrls = await Promise.all(uploadPromises);
        }

        const data = {
            ticketId: currentTicketId,
            action: 'REPAIR_COMPLETE',
            data: {
                workDescription: work,
                warranty: warranty,
                photos: photoUrls
            }
        };

        await callApi('/repair/update', data);
        
        alert("Đã cập nhật trạng thái: Sửa xong / Chờ trả máy!");
        closeModal('modalRepair');
        viewTicketDetail(currentTicketId);

    } catch(err) {
        alert("Lỗi: " + err.message);
    } finally {
        // === KẾT THÚC LOADING ===
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
function handleReturnPhotoSelect(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        compressImage(file, 1024, 0.7).then(blob => {
            returnPhotos.push(blob);
            const url = URL.createObjectURL(blob);
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${url}">`;
            document.getElementById('returnPhotoGrid').appendChild(div);
        });
    });
    input.value = '';
}
async function submitReturnDevice() {
    const amount = document.getElementById('return_amount').value;
    const method = document.getElementById('return_method').value;
    const ticketNum = document.getElementById('return_ticket_number').value.trim();
    const note = document.getElementById('return_note').value.trim();

    // Lấy nút bấm
    const btn = document.querySelector('#modalReturn button[onclick="submitReturnDevice()"]');
    const originalText = btn.innerText;

    if (!amount) { alert("Vui lòng nhập số tiền thực thu."); return; }
    if (!ticketNum) { alert("Vui lòng nhập Số sổ 3 liên."); return; }

    // === BẮT ĐẦU LOADING ===
    btn.disabled = true;
    btn.innerText = '⏳ Đang thanh toán...';

    try {
        // Upload ảnh
        let photoUrls = [];
        if (returnPhotos.length > 0) {
            const storageRef = firebase.storage().ref();
            const timestamp = Date.now();
            const uploadPromises = returnPhotos.map((blob, index) => {
                const fileName = `repair_photos/${currentTicketId}_return_${timestamp}_${index}.jpg`;
                return storageRef.child(fileName).put(blob).then(s => s.ref.getDownloadURL());
            });
            photoUrls = await Promise.all(uploadPromises);
        }

        const data = {
            ticketId: currentTicketId,
            action: 'RETURN_DEVICE',
            data: {
                totalAmount: amount,
                method: method,
                ticketNumber: ticketNum,
                note: note,
                photos: photoUrls
            }
        };

        await callApi('/repair/update', data);
        
        alert("Đã trả máy thành công! Phiếu đã hoàn tất.");
        closeModal('modalReturn');
        viewTicketDetail(currentTicketId);

    } catch (err) {
        alert("Lỗi: " + err.message);
    } finally {
        // === KẾT THÚC LOADING ===
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
// --- LOGIC BÁO GIÁ GỬI NGOÀI ---

function toggleQuoteType() {
    const type = document.querySelector('input[name="quoteType"]:checked').value;
    const container = document.getElementById('modalQuote');
    
    if (type === 'EXTERNAL') {
        // Thêm class để hiện các ô External
        container.classList.add('mode-external');
    } else {
        // Xóa class để ẩn
        container.classList.remove('mode-external');
        // Reset giá gốc về 0 khi chuyển về nội bộ
        document.querySelectorAll('.q-cost').forEach(el => el.value = '');
        document.getElementById('q_ext_ship').value = '';
        document.getElementById('q_ext_unit').value = '';
    }
    calculateQuoteTotal();
}

function applyExternalPriceToTable() {
    const cost = parseFloat(document.getElementById('q_ext_cost').value) || 0;
    const ship = parseFloat(document.getElementById('q_ext_ship').value) || 0;
    const profit = parseFloat(document.getElementById('q_ext_profit').value) || 0;
    const unit = document.getElementById('q_ext_unit').value.trim();
    
    const total = cost + ship + profit;
    
    if (total <= 0) { alert("Vui lòng nhập chi phí."); return; }

    // Xóa bảng cũ
    document.getElementById('quoteItemsBody').innerHTML = '';
    
    // Tạo dòng mới trong bảng với tên dịch vụ và giá tổng vừa tính
    const serviceName = `Sửa chữa (Gửi ${unit || 'đối tác'})`;
    addQuoteRow(serviceName, 1, total);
}
// Mở Modal Gửi/Nhận
function openExternalModal(type) {
    // Kiểm tra loại hình để đổi tiêu đề
    const techSolution = currentTicketData.techCheck ? currentTicketData.techCheck.solution : '';
    const isWarranty = techSolution === 'Gửi hãng';
    
    if (type === 'SEND') {
        // Đổi tiêu đề Modal
        const titleEl = document.querySelector('#modalExtSend h3');
        if (titleEl) titleEl.innerText = isWarranty ? '🛡️ Gửi Máy Đi Bảo Hành' : '🚚 Gửi Máy Đi Sửa Ngoài';

        // Điền tên đơn vị
        let unitName = '';
        if (currentTicketData.quotation && currentTicketData.quotation.externalInfo) {
            unitName = currentTicketData.quotation.externalInfo.unit;
        }
        document.getElementById('ext_send_unit').value = unitName;
        document.getElementById('ext_send_note').value = '';
        document.getElementById('modalExtSend').style.display = 'flex';
    } 
    else if (type === 'RECEIVE') {
        // Kiểm tra xem khách có hủy không
        const confirm = currentTicketData.customerConfirm;
        const isDeclined = confirm && (confirm.result.includes('Không sửa') || confirm.result.includes('Từ chối'));

        const titleEl = document.querySelector('#modalExtReceive h3');
        const pEl = document.querySelector('#modalExtReceive p');
        const qcSelect = document.getElementById('ext_qc_result');
        // Tìm label QC (nằm ngay trước select)
        const qcLabel = qcSelect.previousElementSibling; 
        
        const noteLabel = document.querySelector('label[for="ext_qc_note"]'); // Tìm label ghi chú (cần thêm for vào html hoặc tìm theo text)
        // Cách tìm an toàn hơn nếu chưa có for:
        const allLabels = document.querySelectorAll('#modalExtReceive label');
        const noteLabelEl = allLabels[allLabels.length - 1]; // Label cuối cùng là Ghi chú

        const btnSubmit = document.querySelector('#modalExtReceive button[onclick*="submitExternalAction"]');

        if (isDeclined) {
            // --- GIAO DIỆN NHẬN MÁY HỦY ---
            titleEl.innerText = '↩️ Nhận Máy Về (Khách Hủy)';
            pEl.innerText = 'Máy khách không sửa. Xác nhận nhận lại từ đối tác.';
            
            // Ẩn phần QC
            if(qcSelect) qcSelect.style.display = 'none';
            if(qcLabel) qcLabel.style.display = 'none';
            
            // Đổi text label ghi chú
            if(noteLabelEl) noteLabelEl.innerText = 'Tình trạng máy khi nhận lại:';
            
            // Đổi nút bấm
            btnSubmit.innerText = 'Đã Nhận Về Kho';
            btnSubmit.style.background = '#546e7a'; // Màu xám xanh
        } else {
            // --- GIAO DIỆN QC BÌNH THƯỜNG ---
            titleEl.innerText = '✅ Nhận Máy & Kiểm Tra (QC)';
            pEl.innerText = 'Máy đã được gửi trả về. Kỹ thuật viên cần kiểm tra lại.';
            
            if(qcSelect) qcSelect.style.display = 'block';
            if(qcLabel) qcLabel.style.display = 'block';
            
            if(noteLabelEl) noteLabelEl.innerText = 'Ghi chú kiểm tra:';
            
            btnSubmit.innerText = 'QC Đạt - Chờ Trả Khách';
            btnSubmit.style.background = '#28a745'; // Màu xanh lá
        }

        document.getElementById('ext_qc_note').value = '';
        document.getElementById('modalExtReceive').style.display = 'flex';
    }
}

// Gửi API
async function submitExternalAction(subType) {
    let dataPayload = {};

    if (subType === 'SEND') {
        dataPayload = {
            unitName: document.getElementById('ext_send_unit').value,
            note: document.getElementById('ext_send_note').value.trim()
        };
    } else if (subType === 'RECEIVE_PASS') {
        dataPayload = {
            note: document.getElementById('ext_qc_note').value.trim()
        };
    }

    const data = {
        ticketId: currentTicketId,
        action: 'EXTERNAL_ACTION',
        data: { subType: subType, ...dataPayload }
    };

    const spinner = document.getElementById('createSpinner');
    if(spinner) spinner.style.display = 'block';

    callApi('/repair/update', data)
        .then(() => {
            alert("Cập nhật trạng thái thành công!");
            closeModal('modalExtSend');
            closeModal('modalExtReceive');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => { if(spinner) spinner.style.display = 'none'; });
}
/**
 * [SALE/ADMIN] Kích hoạt trạng thái Chờ Đặt Hàng
 */
async function triggerOrderParts() {
    const note = prompt("Nhập ghi chú đặt hàng (Tên linh kiện, Nhà cung cấp...):");
    if (note === null) return; // Hủy

    const spinner = document.getElementById('createSpinner');
    if(spinner) spinner.style.display = 'block';

    const data = {
        ticketId: currentTicketId,
        action: 'ORDER_PARTS',
        data: { note: note || '' }
    };

    callApi('/repair/update', data)
        .then(() => {
            alert("Đã chuyển sang trạng thái: Chờ đặt hàng.");
            viewTicketDetail(currentTicketId);
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => { if(spinner) spinner.style.display = 'none'; });
}

/**
 * [SALE/ADMIN/KHO] Xác nhận Đã Có Hàng
 */
async function triggerPartsArrived() {
    if (!confirm("Xác nhận linh kiện đã về kho?")) return;

    const spinner = document.getElementById('createSpinner');
    if(spinner) spinner.style.display = 'block';

    const data = {
        ticketId: currentTicketId,
        action: 'PARTS_ARRIVED',
        data: {}
    };

    callApi('/repair/update', data)
        .then(() => {
            alert("Đã cập nhật: Linh kiện đã về. KTV có thể sửa.");
            viewTicketDetail(currentTicketId);
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => { if(spinner) spinner.style.display = 'none'; });
}

let currentAssignStep = ''; // Lưu bước đang giao (CHECK/REPAIR)

async function openAssignModal(step) {
    currentAssignStep = step;
    const select = document.getElementById('assign_tech_select');
    select.innerHTML = '<option>Đang tải...</option>';
    
    document.getElementById('modalAssign').style.display = 'flex';

    try {
        // Gọi API lấy danh sách KTV (Đã có sẵn từ auditor.js, dùng lại)
        const techs = await callApi('/public/technicians');
        
        select.innerHTML = '<option value="">-- Chọn KTV --</option>';
        techs.forEach(t => {
            const option = document.createElement('option');
            option.value = t.email;
            option.text = t.name || t.email;
            // Lưu thêm tên vào data attribute để tiện lấy
            option.setAttribute('data-name', t.name || t.email);
            select.appendChild(option);
        });
    } catch (err) {
        alert("Lỗi tải danh sách KTV: " + err.message);
        closeModal('modalAssign');
    }
}

async function submitAssignWork() {
    const select = document.getElementById('assign_tech_select');
    const email = select.value;
    const name = select.options[select.selectedIndex].getAttribute('data-name');

    if (!email) {
        alert("Vui lòng chọn Kỹ thuật viên.");
        return;
    }

    const btn = document.querySelector('#modalAssign button[onclick="submitAssignWork()"]');
    btn.innerText = 'Đang giao...';
    btn.disabled = true;

    const data = {
        ticketId: currentTicketId,
        action: 'MANAGER_ASSIGN',
        data: {
            step: currentAssignStep, // 'CHECK' hoặc 'REPAIR'
            assignee: { email: email, name: name }
        }
    };

    callApi('/repair/update', data)
        .then(() => {
            alert(`Đã giao việc cho ${name}!`);
            closeModal('modalAssign');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => {
            btn.innerText = 'Xác nhận Giao';
            btn.disabled = false;
        });
}

// --- LOGIC ACTION SHEET ẢNH ---
let currentPhotoPrefix = ''; // Lưu xem đang bấm nút ở mục nào (create/check/repair/return)

function openPhotoActionSheet(prefix) {
    currentPhotoPrefix = prefix;
    document.getElementById('photoActionSheet').style.display = 'flex';
}

function closePhotoActionSheet() {
    document.getElementById('photoActionSheet').style.display = 'none';
}

function triggerPhotoInput(type) {
    // Đóng menu
    closePhotoActionSheet();
    
    // Xác định ID input cần kích hoạt
    // type = 'cam' -> ID_Cam
    // type = 'gal' -> ID_Gal
    const suffix = type === 'cam' ? '_Cam' : '_Gal';
    const inputId = currentPhotoPrefix + suffix;
    
    const input = document.getElementById(inputId);
    if (input) {
        input.click();
    } else {
        console.error("Không tìm thấy input: " + inputId);
    }
}
/**
 * [TIỆN ÍCH] In Phiếu Tiếp Nhận
 */
/**
 * [TIỆN ÍCH] In Phiếu Tiếp Nhận (Tối ưu cho khổ K80)
 */
// public/repair.js - Hàm in phiếu K80 tối giản

function printTicket() {
    if (!currentTicketData) {
        alert("Chưa có dữ liệu phiếu để in.");
        return;
    }

    const t = currentTicketData;
    const printWindow = window.open('', '', 'width=400,height=600');
    
    // Format dữ liệu
    const dateStr = new Date(t.createdAt).toLocaleString('vi-VN', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    const accessories = (t.accessories && t.accessories.length > 0) ? t.accessories.join(', ') : 'Không';
    const receiverName = t.creatorName || t.createdBy || 'NV';

    const htmlContent = `
        <html>
        <head>
            <title>IN PHIẾU ${t.ticketId}</title>
            <style>
                @page { margin: 0; size: auto; }
                body {
                    font-family: 'Arial', sans-serif;
                    font-size: 12px;
                    line-height: 1.3;
                    margin: 0;
                    padding: 5px 2px 0 2px; /* Bỏ lề dưới */
                    width: 72mm; 
                    color: #000;
                }
                .text-center { text-align: center; }
                .text-bold { font-weight: bold; }
                .text-huge { font-size: 22px; font-weight: 900; letter-spacing: 1px; }
                
                .dashed-line { border-top: 1px dashed #000; margin: 5px 0; }
                
                .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
                .lbl { white-space: nowrap; padding-right: 5px; font-size: 11px; color: #333; }
                .val { text-align: right; font-weight: bold; word-break: break-word; }
                
                .box-issue {
                    border: 1px solid #000;
                    padding: 5px;
                    margin-top: 5px;
                    font-weight: bold;
                    font-size: 13px;
                    margin-bottom: 5px;
                }
            </style>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        </head>
        <body>
            <div class="text-center text-bold">CTY TNHH HN DOTNET</div>
            <div class="text-center" style="font-size:10px;">1800.9379 - ${dateStr}</div>
            
            <div class="dashed-line"></div>

            <div class="text-center">
                <div style="font-size:10px;">PHIẾU BIÊN NHẬN</div>
                <div class="text-huge">${t.ticketId}</div>
            </div>

            <div class="dashed-line"></div>

            <div class="row">
                <span class="lbl">Khách:</span>
                <span class="val">${t.customerName}</span>
            </div>
            <div class="row">
                <span class="lbl">SĐT:</span>
                <span class="val">${t.customerPhone}</span>
            </div>
            <div class="dashed-line" style="opacity:0.3"></div>
            
            <div class="row">
                <span class="lbl">Thiết bị:</span>
                <span class="val">${t.deviceType} ${t.deviceBrand} ${t.deviceModel}</span>
            </div>
            <div class="row">
                <span class="lbl">Phụ kiện:</span>
                <span class="val" style="font-weight:normal; font-style:italic;">${accessories}</span>
            </div>

            <div class="box-issue">
                ${t.issueDescription}
            </div>

            <div class="row" style="margin-top: 2px;">
                <span class="lbl">Người nhận:</span>
                <span class="val">${receiverName}</span>
            </div>

            <div style="display:flex; justify-content:center; margin-top:10px;">
                <div id="qrcode"></div>
            </div>
            <div class="text-center" style="font-size:10px; margin-top:2px; margin-bottom:10px;">Quét để tra cứu</div>

            <div class="text-center" style="font-size:10px; font-style:italic; border-top: 1px dashed #ccc; padding-top: 5px;">
                Vui lòng mang theo phiếu này khi nhận máy. <br> Xin cảm ơn!
            </div>

            <script>
                window.onload = function() {
                    new QRCode(document.getElementById("qrcode"), {
                        text: "${t.ticketId}",
                        width: 80,
                        height: 80,
                        correctLevel : QRCode.CorrectLevel.L
                    });
                    setTimeout(function(){ window.print(); }, 300);
                };
            <\/script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
}
function startTicketQrScanner() {
    document.getElementById('ticketQrModal').style.display = 'flex';
    
    if (ticketQrScanner) {
        // Đã khởi tạo rồi thì render lại (nếu cần)
        return;
    }

    ticketQrScanner = new Html5Qrcode("ticket-qr-reader");
    
    const config = { fps: 10, qrbox: 250 };
    
    ticketQrScanner.start(
        { facingMode: "environment" }, // Camera sau
        config,
        (decodedText) => {
            // KHI QUÉT THÀNH CÔNG
            console.log(`Quét được: ${decodedText}`);
            
            // Kiểm tra định dạng (SC25-xxxx)
            if (decodedText.startsWith("SC")) {
                stopTicketQrScanner(); // Tắt camera
                viewTicketDetail(decodedText); // Mở chi tiết phiếu
            } else {
                alert("Mã không hợp lệ: " + decodedText);
            }
        },
        (errorMessage) => {
            // Bỏ qua lỗi quét
        }
    ).catch(err => {
        console.error(err);
        alert("Lỗi khởi động camera: " + err);
        document.getElementById('ticketQrModal').style.display = 'none';
    });
}

function stopTicketQrScanner() {
    const modal = document.getElementById('ticketQrModal');
    modal.style.display = 'none';
    
    if (ticketQrScanner) {
        ticketQrScanner.stop().then(() => {
            ticketQrScanner.clear();
            ticketQrScanner = null;
        }).catch(err => console.warn(err));
    }
}
/**
 * [TIỆN ÍCH] In Tem Dán Thiết Bị (Mẫu To - Khổ 80mm)
 */
function printDeviceLabel() {
    if (!currentTicketData) {
        alert("Chưa có dữ liệu phiếu để in.");
        return;
    }

    const t = currentTicketData;
    const printWindow = window.open('', '', 'width=500,height=600');
    
    // Chuẩn bị dữ liệu hiển thị
    const dateStr = new Date(t.createdAt).toLocaleString('vi-VN', {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'});
    const accessories = (t.accessories || []).join(', ') || 'Không';
    
    // HTML cho Tem 80mm
    const htmlContent = `
        <html>
        <head>
            <title>Tem Dán ${t.ticketId}</title>
            <style>
                @page { margin: 0; size: auto; }
                body {
                    font-family: 'Arial', sans-serif;
                    margin: 0;
                    padding: 5px;
                    width: 75mm; /* Chiều rộng an toàn cho khổ giấy 80mm */
                    color: #000;
                }
                
                .container {
                    border: 2px solid #000;
                    border-radius: 8px;
                    padding: 8px;
                    box-sizing: border-box;
                    overflow: hidden;
                }

                /* Header: Mã phiếu to + Ngày */
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 2px solid #000;
                    padding-bottom: 5px;
                    margin-bottom: 5px;
                }
                .ticket-id {
                    font-size: 20px;
                    font-weight: 900;
                    text-transform: uppercase;
                }
                .date {
                    font-size: 10px;
                    font-style: italic;
                }

                /* Thông tin khách hàng (Nổi bật SĐT) */
                .customer-section {
                    margin-bottom: 8px;
                    border-bottom: 1px dashed #999;
                    padding-bottom: 5px;
                }
                .cust-name { font-size: 14px; font-weight: bold; }
                .cust-phone { font-size: 18px; font-weight: 900; margin-top: 2px; letter-spacing: 1px;}

                /* Thông tin máy & Lỗi */
                .device-section {
                    margin-bottom: 8px;
                }
                .row { display: flex; margin-bottom: 3px; }
                .label { width: 60px; font-size: 11px; color: #444; flex-shrink: 0;}
                .val { font-size: 12px; font-weight: 600; flex: 1; }
                
                .issue-box {
                    border: 1px solid #000;
                    padding: 5px;
                    margin-top: 5px;
                    border-radius: 4px;
                    background: #f0f0f0; /* Nền xám nhẹ nếu in màu (hoặc trắng đen vẫn rõ) */
                }
                .issue-title { font-size: 10px; font-weight: bold; text-transform: uppercase; }
                .issue-content { font-size: 13px; font-weight: bold; line-height: 1.3; }

                /* Footer: QR Code + Phụ kiện */
                .footer {
                    display: flex;
                    align-items: center;
                    margin-top: 10px;
                    border-top: 2px solid #000;
                    padding-top: 5px;
                }
                .qr-box {
                    width: 80px;
                    margin-right: 10px;
                }
                .acc-box {
                    flex: 1;
                    font-size: 11px;
                }
            </style>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="ticket-id">${t.ticketId}</div>
                    <div class="date">${dateStr}</div>
                </div>

                <div class="customer-section">
                    <div class="cust-name">${t.customerName}</div>
                    <div class="cust-phone">${t.customerPhone}</div>
                </div>

                <div class="device-section">
                    <div class="row">
                        <span class="label">Thiết bị:</span>
                        <span class="val">${t.deviceType} - ${t.deviceBrand} ${t.deviceModel}</span>
                    </div>
                    
                    <div class="issue-box">
                        <div class="issue-title">TÌNH TRẠNG / LỖI:</div>
                        <div class="issue-content">${t.issueDescription}</div>
                    </div>
                </div>

                <div class="footer">
                    <div class="qr-box">
                        <div id="qrcode"></div>
                    </div>
                    <div class="acc-box">
                        <strong>Phụ kiện kèm theo:</strong><br>
                        ${accessories}
                    </div>
                </div>
            </div>

            <script>
                window.onload = function() {
                    // QR Code lớn, dễ quét
                    new QRCode(document.getElementById("qrcode"), {
                        text: "${t.ticketId}",
                        width: 80,
                        height: 80,
                        correctLevel : QRCode.CorrectLevel.M
                    });
                    
                    setTimeout(function(){ window.print(); }, 500);
                };
            <\/script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
}