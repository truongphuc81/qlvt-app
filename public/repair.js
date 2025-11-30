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
let userMap = {};
// === AUTH & INIT ===
document.addEventListener('DOMContentLoaded', function(){ 
    populateMonthFilter();
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
            // 1. Lấy Quyền
            callApi('/auth/getSelfRoles', {})
            .then(roles => {
                userRoles = roles; // Lưu quyền vào biến toàn cục
                console.log("User Roles:", userRoles);
                // Sau khi có quyền thì mới load ticket (hoặc load lại giao diện nếu cần)
            });
            // 2. [MỚI] Lấy Danh sách nhân viên để tra tên
            callApi('/public/technicians')
            .then(users => {
                // Biến đổi mảng thành object cho dễ tra cứu: { 'a@gmail.com': 'Nguyễn Văn A' }
                users.forEach(u => { 
                    if(u.email) {
                        // Lưu cả tên và avatar
                        userMap[u.email] = { name: u.name || u.email, avatarUrl: u.avatarUrl || '' };
                    }
                });
                console.log("User Map loaded:", Object.keys(userMap).length);
                
                // Sau khi có từ điển tên thì mới tải lại danh sách phiếu để cập nhật tên hiển thị
                // (Nếu đang ở trang chi tiết thì tải lại chi tiết)
                if (currentTicketId) {
                    viewTicketDetail(currentTicketId);
                } else {
                    fetchTicketsAPI(false); 
                } 
            });

            showView('list');
        } else {
            if (authButton) {
                authButton.style.display = 'inline-block';
                authButton.onclick = signInWithGoogle; 
            }
            if (signOutButton) signOutButton.style.display = 'none';
            document.getElementById('app-container').style.display = 'none';
        }
    });

    // [MỚI] Auto-filter listeners
    const searchTicketInput = document.getElementById('searchTicket');
    const filterMonthSelect = document.getElementById('filterMonth');

    const debouncedFilter = debounce(() => fetchTicketsAPI(false), 300);

    if (searchTicketInput) {
        searchTicketInput.addEventListener('input', debouncedFilter); // Tự động lọc khi gõ
    }

    if (filterMonthSelect) {
        filterMonthSelect.addEventListener('change', () => fetchTicketsAPI(false)); // Tự động lọc khi chọn
    }
});

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function populateMonthFilter() {
    const filterMonth = document.getElementById('filterMonth');
    if (!filterMonth) return;
    
    // Clear existing options except the first one
    while (filterMonth.options.length > 1) {
        filterMonth.remove(1);
    }

    const months = [];
    const now = new Date();

    // Add current and previous 11 months
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        months.push({
            value: `${year}-${month}`,
            text: `Tháng ${month}/${year}`
        });
    }
    
    months.forEach(m => {
        const option = document.createElement('option');
        option.value = m.value;
        option.text = m.text;
        filterMonth.appendChild(option);
    });
}

// === LOGIC GIAO DIỆN ===

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
        
        fetchTicketsAPI(false); 
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

    if (selectedPhotos.length + files.length > 5) {
        Swal.fire({
            icon: 'warning',
            title: 'Quá nhiều ảnh',
            text: 'Chỉ được phép tải lên tối đa 5 ảnh.'
        });
        return;
    }

    files.forEach(file => {
        compressImage(file, 1024, 0.7).then(compressedBlob => {
            selectedPhotos.push(compressedBlob);
            renderPhotoGrid();
        }).catch(err => console.error("Lỗi nén ảnh:", err));
    });
    
    input.value = ''; 
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
    const custName = document.getElementById('custName').value.trim();
    const custPhone = document.getElementById('custPhone').value.trim();
    const customerDesc = document.getElementById('customerDesc').value.trim();
    
    if (!custName || !custPhone || !customerDesc) {
        Swal.fire({
            icon: 'warning',
            title: 'Thiếu thông tin',
            text: 'Vui lòng nhập Tên khách, SĐT và Lỗi mô tả (*)'
        });
        return;
    }

    Swal.fire({
        title: 'Đang xử lý...',
        text: 'Vui lòng chờ trong khi hệ thống nén ảnh và tạo phiếu.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const photoUrls = [];
        if (selectedPhotos.length > 0) {
            const storageRef = firebase.storage().ref();
            const timestamp = Date.now();
            const uploadPromises = selectedPhotos.map((blob, index) => {
                const fileName = `repair_photos/${timestamp}_${index}.jpg`;
                const fileRef = storageRef.child(fileName);
                return fileRef.put(blob).then(snapshot => snapshot.ref.getDownloadURL());
            });
            const urls = await Promise.all(uploadPromises);
            photoUrls.push(...urls);
        }

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
            photos: photoUrls
        };

        const result = await callApi('/repair/create', ticketData);
        
        Swal.fire({
            icon: 'success',
            title: 'Tạo phiếu thành công!',
            text: `Mã phiếu của bạn là: ${result.ticketId}`
        });
        
        if (isPrint) {
            callApi('/repair/detail', { ticketId: result.ticketId })
            .then(ticket => {
                currentTicketData = ticket;
                printTicket();
            })
            .catch(err => {
                console.error("Lỗi tải chi tiết phiếu để in:", err);
                Swal.fire('Lỗi', `Lỗi tải chi tiết phiếu để in: ${err.message}`, 'error');
            });
        }
        
        showView('list');

    } catch (error) {
        console.error("Lỗi tạo phiếu:", error);
        Swal.fire({
            icon: 'error',
            title: 'Lỗi tạo phiếu',
            text: error.message
        });
    }
}


function loadMoreTickets() {
    if (!lastLoadedTicketId) return;
    const btn = document.getElementById('loadMoreTickets');
    btn.innerText = 'Đang tải...';
    btn.disabled = true;
    
    fetchTicketsAPI(true);
}

function getStatusBadgeClass(status) {
    if (!status) return 'bg-secondary';
    const s = status.toLowerCase(); // Make matching case-insensitive

    if (s.includes('hoàn tất') || s.includes('đã trả') || s.includes('trả máy')) {
        return 'bg-success';
    }
    if (s.includes('đang sửa') || s.includes('sửa ngoài')) {
        return 'bg-danger';
    }
    if (s.includes('báo giá') || s.includes('chờ khách')) {
        return 'bg-warning text-dark';
    }
    if (s.includes('kiểm tra') || s.includes('chờ đặt hàng') || s.includes('đã có hàng')) {
        return 'bg-info text-dark';
    }
    if (s.includes('mới nhận')) {
        return 'bg-primary';
    }
    return 'bg-secondary';
}

function createTicketCardHTML(t) {
    const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString('vi-VN') : 'N/A';
    
    let borderColor = 'var(--primary-color)';
    if (t.currentStatus.includes('sửa')) {
        borderColor = 'var(--danger-color)';
    } else if (t.currentStatus.includes('Hoàn tất') || t.currentStatus.includes('Đã trả')) {
        borderColor = 'var(--success-color)';
    } else if (t.currentStatus.includes('báo giá') || t.currentStatus.includes('Chờ khách')) {
        borderColor = 'var(--warning-color)';
    } else if (t.currentStatus.includes('kiểm tra')) {
        borderColor = 'var(--info-color)';
    }

    const badgeClass = getStatusBadgeClass(t.currentStatus); // Get dynamic badge class

    return `
        <div class="kanban-card" onclick="viewTicketDetail('${t.ticketId}')" style="border-left-color: ${borderColor};">
            <div class="card-title">
                ${t.ticketId}
            </div>
            <div class="card-subtitle">
                ${t.customerName} - ${t.customerPhone}
            </div>
            <p class="card-text">
                <strong>Máy:</strong> ${t.deviceBrand} ${t.deviceModel}
            </p>
            <p class="card-text">
                <strong>Lỗi:</strong> ${t.issueDescription || 'Chưa mô tả'}
            </p>
            <div class="card-footer">
                <span style="display: flex; align-items: center; gap: 4px;"><span class="material-icons" style="font-size: 1.1em;">calendar_today</span> ${dateStr}</span>
                <span class="badge ${badgeClass}">${t.currentStatus}</span>
            </div>
        </div>
    `;
}

function fetchTicketsAPI(isLoadMore) {
    const btnMore = document.getElementById('loadMoreTickets');
    const monthFilter = document.getElementById('filterMonth').value;
    const searchText = document.getElementById('searchTicket').value.trim();

    const statusToColumnId = {
        'Mới nhận': 'kanban-new',
        'Đang kiểm tra': 'kanban-checking',
        'Chờ báo giá': 'kanban-quoting',
        'Đang sửa': 'kanban-repairing',
        'Hoàn tất': 'kanban-done',
        'Chờ khách xác nhận': 'kanban-quoting',
        'Chờ đặt hàng': 'kanban-repairing',
        'Đã có hàng': 'kanban-repairing',
        'Đang sửa ngoài': 'kanban-repairing',
        'Chờ trả máy': 'kanban-done',
        'Trả máy không sửa': 'kanban-done',
        'Đã trả': 'kanban-done'
    };

    if (!isLoadMore) {
        Swal.fire({
            title: 'Đang tải dữ liệu...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    }

    const payload = { 
        month: monthFilter, 
        search: searchText,
        lastTicketId: isLoadMore ? lastLoadedTicketId : null
    };

    // Dòng này để debug, kiểm tra xem payload gửi đi có đúng không
    console.log('Đang gửi yêu cầu API với payload:', payload);

    callApi('/repair/list', payload)
        .then(tickets => {
            if (!isLoadMore) {
                Swal.close();
                // Di chuyển việc xóa vào đây để đảm bảo nó chỉ chạy khi API đã trả về
                document.querySelectorAll('.kanban-cards').forEach(col => col.innerHTML = '');
            }

            if (!tickets || tickets.length === 0) {
                if (!isLoadMore) {
                    // Hiển thị thông báo khi không có phiếu nào
                    document.getElementById('kanban-new').querySelector('.kanban-cards').innerHTML = '<p class="text-center text-muted mt-3">Không có phiếu nào.</p>';
                }
                if (btnMore) btnMore.style.display = 'none';
                return;
            }

            lastLoadedTicketId = tickets[tickets.length - 1].ticketId;

            if (btnMore) {
                if (tickets.length < 20) {
                    btnMore.style.display = 'none';
                } else {
                    btnMore.style.display = 'block';
                    btnMore.innerText = 'Tải thêm';
                    btnMore.disabled = false;
                }
            }

            tickets.forEach(t => {
                const columnId = statusToColumnId[t.currentStatus] || 'kanban-new';
                const column = document.getElementById(columnId);
                if (column) {
                    const cardHTML = createTicketCardHTML(t);
                    column.querySelector('.kanban-cards').insertAdjacentHTML('beforeend', cardHTML);
                }
            });
        })
        .catch(err => {
            Swal.close(); // Đảm bảo đóng loading khi có lỗi
            if (!isLoadMore) {
                 // Xóa bảng nếu có lỗi khi tải lại từ đầu
                document.querySelectorAll('.kanban-cards').forEach(col => col.innerHTML = '');
            }
            Swal.fire({
                icon: 'error',
                title: 'Lỗi',
                text: `Không thể tải dữ liệu: ${err.message}`
            });
            console.error(err);
        });
}

function viewTicketDetail(ticketId) {
    currentTicketId = ticketId;
    showView('detail');
    
    document.getElementById('d_ticketId').innerText = ticketId;
    document.getElementById('d_custName').innerText = 'Đang tải...';
    
    callApi('/repair/detail', { ticketId: ticketId })
        .then(ticket => {
            currentTicketData = ticket;
            renderTicketDetail(ticket);
        })
        .catch(err => {
            console.error(err);
            Swal.fire({
                icon: 'error',
                title: 'Lỗi',
                text: `Lỗi tải chi tiết phiếu: ${err.message}`
            });
            showView('list');
        });
}

function renderTicketDetail(t) {
    const isManager = userRoles.admin || userRoles.inventory_manager || userRoles.sale;
    const myEmail = userEmail;
    document.getElementById('d_ticketId').innerText = t.ticketId;
    document.getElementById('d_createdAt').innerText = new Date(t.createdAt).toLocaleString('vi-VN');
    
    document.getElementById('d_custName').innerText = t.customerName;
    document.getElementById('d_custPhone').innerText = t.customerPhone;
    document.getElementById('d_custAddress').innerText = t.customerAddress || '---';
    
    document.getElementById('d_deviceInfo').innerText = `${t.deviceType} - ${t.deviceBrand} ${t.deviceModel}`;
    document.getElementById('d_deviceSerial').innerText = t.deviceSerial || '---';
    const accStr = (t.accessories || []).join(', ');
    document.getElementById('d_accessories').innerText = accStr || 'Không có';
    
    document.getElementById('d_issueDesc').innerText = t.issueDescription;
    document.getElementById('d_physicalDesc').innerText = t.physicalCondition || 'Bình thường';
    
    if(document.getElementById('d_receiver')) {
        document.getElementById('d_receiver').innerText = t.creatorName || t.createdBy;
        const receiverAvatar = document.getElementById('d_receiver_avatar');
        const receiverInfo = userMap[t.createdBy] || {};
        if (receiverAvatar) {
            receiverAvatar.src = receiverInfo.avatarUrl || '/default-avatar.png';
            receiverAvatar.classList.add('avatar-small');
            receiverAvatar.style.width = '20px';
            receiverAvatar.style.height = '20px';
            receiverAvatar.style.display = 'inline-block';
        }
    }
    
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

    const isTicketLocked = t.currentStatus === 'Hoàn tất' || t.currentStatus === 'Đã trả máy';

    const techBlock = document.getElementById('content_techCheck');
    const btnUpdateCheck = document.getElementById('btn_update_check');
    
    if (btnUpdateCheck) btnUpdateCheck.style.display = isTicketLocked ? 'none' : 'block';

    if (t.techCheck) {
        const techEmail = (t.assignedTechCheck && t.assignedTechCheck.email) || t.techCheck.technicianEmail;
        const techInfo = userMap[techEmail] || {};
        const techName = (t.assignedTechCheck && t.assignedTechCheck.name) || techInfo.name || techEmail;
        const techAvatarUrl = (t.assignedTechCheck && t.assignedTechCheck.avatarUrl) || techInfo.avatarUrl || '/default-avatar.png';
        const techAvatarImg = `<img src="${techAvatarUrl}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;

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
                <div><strong>KTV:</strong> ${techAvatarImg} ${techName}</div> <div style="margin-top:5px;"><strong>Nguyên nhân:</strong> ${t.techCheck.cause}</div>
                <div><strong>Đề xuất:</strong> ${t.techCheck.solution}</div>
                <div><strong>Linh kiện:</strong> ${t.techCheck.components || 'Không'}</div>
                ${techPhotosHtml} 
            </div>
        `;
    } else {
        if (!isTicketLocked) {
            let assignHtml = '';
            
            if (t.assignedTechCheck) {
                const assignee = t.assignedTechCheck;
                const assigneeAvatarUrl = assignee.avatarUrl || (userMap[assignee.email] ? userMap[assignee.email].avatarUrl : '') || '/default-avatar.png';
                const assigneeAvatarImg = `<img src="${assigneeAvatarUrl}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;
                const isMe = (assignee.email === myEmail);
                
                assignHtml = `
                    <div style="margin-bottom:10px; color:#0d47a1; background:#e3f2fd; padding:8px; border-radius:4px; border-left: 3px solid #2196f3;">
                        👤 KTV: <strong>${assigneeAvatarImg} ${assignee.name}</strong><br>
                        <small style="color:#666;">Giao bởi ${assignee.assignedBy} lúc ${new Date(assignee.assignedAt).toLocaleString('vi-VN')}</small>
                    </div>
                `;

                if (isMe || isManager) {
                    if (btnUpdateCheck) {
                        btnUpdateCheck.style.display = 'block';
                        btnUpdateCheck.innerText = '📝 Báo Cáo Kết Quả';
                    }
                }
                
                if (isManager) {
                     assignHtml += `
                        <div style="text-align:right; margin-bottom:5px;">
                            <button onclick="openAssignModal('CHECK')" style="background:none; border:none; color:#2196f3; cursor:pointer; font-size:12px; text-decoration:underline;">
                                🔄 Giao người khác
                            </button>
                        </div>`;
                }

            } else {
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
            if (log.receivedDate) {
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
        } else {
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

    const quoteBlock = document.getElementById('content_quotation');
    const quoteContainer = document.getElementById('block_quotation');
    const btnUpdateQuote = document.getElementById('btn_update_quote');
    const canUpdate = (userRoles.sale || userRoles.admin) && !isTicketLocked;

    let isReadyToQuote = true;
    if (isKtvSuggestExternal && !hasExternalLog) {
        isReadyToQuote = false; 
    }

    if (t.quotation) {
        quoteContainer.style.opacity = '1';
        if(btnUpdateQuote) {
            btnUpdateQuote.style.display = canUpdate ? 'block' : 'none'; 
            btnUpdateQuote.innerText = 'Cập nhật';
        }
        
        let itemsHtml = '<table style="width:100%; font-size:13px; border-collapse: collapse;">';
        
        const showCost = (userRoles.admin || userRoles.sale) && t.quotation.type === 'EXTERNAL';
        
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
        const totalFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(t.quotation.totalPrice || 0);
        
        const qSaleEmail = t.quotation.saleEmail || '';
        const qSaleName = t.quotation.saleName || '';
        const saleInfo = userMap[qSaleEmail] || {};
        const saleName = qSaleName || saleInfo.name || qSaleEmail || '---';
        const saleAvatar = `<img src="${saleInfo.avatarUrl || '/default-avatar.png'}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;

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
                    Sale: <strong>${saleAvatar} ${saleName}</strong>
                </div>
            </div>
            
            ${
                t.customerConfirm ?
                (() => {
                    const isAgreed = t.customerConfirm.result === 'Đồng ý sửa';
                    const bgColor = isAgreed ? '#e8f5e9' : '#fbe9e7';
                    const borderColor = isAgreed ? '#4caf50' : '#ff5722';
                    const icon = isAgreed ? '✅' : '❌';

                    return `
                        <div style="margin-top: 10px; padding: 10px; border-radius: 6px; background: ${bgColor}; border-left: 4px solid ${borderColor};">
                            <div style="font-weight: bold; color: ${borderColor}; margin-bottom: 5px;">
                                ${icon} Khách đã chốt: ${t.customerConfirm.result}
                            </div>
                            ${t.customerConfirm.note ? `<div style="font-size: 12px; font-style: italic;">Ghi chú: "${t.customerConfirm.note}"</div>` : ''}
                            <div style="font-size: 11px; color: #666; text-align: right; margin-top: 5px;">
                                ${new Date(t.customerConfirm.date).toLocaleString('vi-VN')}
                            </div>
                        </div>`;
                })() : ''
            }
        `;
    } else {
        if (t.techCheck) {
            quoteContainer.style.opacity = '1';
            
            if (canUpdate) {
                if (isReadyToQuote) {
                    if(btnUpdateQuote) {
                        btnUpdateQuote.style.display = 'block';
                        btnUpdateQuote.innerText = '➕ Lên Báo Giá';
                        btnUpdateQuote.style.backgroundColor = '#28a745';
                    }
                    quoteBlock.innerHTML = '<div style="color:#666; font-style:italic;">Chưa có báo giá.</div>';
                } else {
                    if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
                    quoteBlock.innerHTML = '<div style="color:#e65100; font-style:italic;">⚠️ Vui lòng gửi máy đi sửa ngoài trước khi báo giá.</div>';
                }
            } else {
                if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
                quoteBlock.innerHTML = '<div style="color:#666; font-style:italic;">Chờ Phòng Kinh Doanh báo giá...</div>';
            }
        } else {
            quoteContainer.style.opacity = '0.6';
            if(btnUpdateQuote) btnUpdateQuote.style.display = 'none';
            quoteBlock.innerHTML = 'Đang chờ kỹ thuật kiểm tra...';
        }
    }

    const repairBlock = document.getElementById('content_repair');
    const repairContainer = document.getElementById('block_repair');
    
    const canOrder = userRoles.sale || userRoles.admin || userRoles.inventory_manager;

    if (t.currentStatus === 'Chờ khách xác nhận') {
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
        repairContainer.style.opacity = '1';
        const orderInfo = t.partOrder || {};
        
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
        repairContainer.style.opacity = '1';
        let confirmInfo = '';
        if (t.customerConfirm) {
            confirmInfo = `<div style="margin-bottom:10px; font-style:italic;">Khách đã chốt: ${t.customerConfirm.result} (${new Date(t.customerConfirm.date).toLocaleString('vi-VN')})</div>`;
        }

        const techSolution = t.techCheck ? t.techCheck.solution : '';
        let unitName = t.quotation && t.quotation.externalInfo ? t.quotation.externalInfo.unit : '';
        
        const isWarranty = (techSolution === 'Gửi hãng') || 
                           (unitName && unitName.toLowerCase().includes('hãng')) || 
                           (unitName && unitName.toLowerCase().includes('bảo hành'));

        const hasCustomerConfirmed = t.customerConfirm && t.customerConfirm.result === 'Đồng ý sửa';

        const labelAction = isWarranty ? 'Gửi đi Bảo Hành' : 'Gửi đi Sửa Ngoài';
        const labelStatus = isWarranty ? 'Máy đang được Bảo Hành' : 'Máy đang ở đơn vị ngoài';
        const colorStyle  = isWarranty ? '#17a2b8' : '#ff9800'; 
        const bgStyle     = isWarranty ? '#e0f7fa' : '#fff3e0';

        const isExternal = t.quotation && t.quotation.type === 'EXTERNAL';

        if (isExternal || isKtvSuggestExternal) {
            if (t.currentStatus === 'Đang sửa ngoài') {
                const log = t.externalLogistics || {};
                
                const confirm = t.customerConfirm;
                const isDeclined = confirm && (confirm.result.includes('Không sửa') || confirm.result.includes('Từ chối'));
                
                let statusTitle = `⏳ ${labelStatus}...`;
                let boxStyle = `border:2px solid ${colorStyle}; background:${bgStyle};`;
                
                if (isDeclined) {
                    statusTitle = `⚠️ KHÁCH ĐÃ HỦY - CẦN RÚT MÁY VỀ`;
                    boxStyle = `border:2px solid #dc3545; background:#fff5f5;`;
                }

                let receiveBtnHtml = '';
                if (confirm) {
                    receiveBtnHtml = `
                        <button onclick="openExternalModal('RECEIVE')" class="btn-sm" style="background:#28a745; padding:10px 20px; margin-top:10px;">
                            ✅ Đã Nhận Về
                        </button>
                    `;
                }

                repairBlock.innerHTML = `
                    ${confirmInfo}
                    <div style="text-align:center; padding:15px; ${boxStyle} border-radius:8px;">
                        <h4 style="margin-top:0; color:${isDeclined ? '#dc3545' : colorStyle};">${statusTitle}</h4>
                        <div style="font-size:13px; margin-bottom:10px;">
                            Gửi lúc: ${log.sentDate ? new Date(log.sentDate).toLocaleString('vi-VN') : '---'}<br>
                            Nơi nhận: <strong>${log.unitName}</strong>
                        </div>
                        ${receiveBtnHtml}
                    </div>
                `;
            } else {
                if (!unitName) unitName = 'Đối tác / Hãng';
                
                repairBlock.innerHTML = `
                    ${confirmInfo}
                    <div style="text-align:center; padding:15px; border:2px dashed ${colorStyle}; background:${bgStyle}; border-radius:8px;">
                        <h4 style="margin-top:0; color:${colorStyle};">🚚 Cần ${labelAction}</h4>
                        <div style="margin-bottom:10px;">(Vui lòng thực hiện ở khối Điều phối bên trên)</div>
                    </div>
                `;
            }
        } else if (hasCustomerConfirmed) {
            let orderBtn = '';
            if (canOrder) {
                orderBtn = `
                    <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #ccc;">
                         <button onclick="triggerOrderParts()" style="background:none; border:1px solid #f57c00; color:#f57c00; padding:5px 10px; font-size:12px; border-radius:4px; cursor:pointer;">
                            📦 Thiếu đồ? Đặt linh kiện ngay
                        </button>
                    </div>`;
            }

            let workerHtml = '';
            if (t.assignedRepair) {
                const assignee = t.assignedRepair;
                const assigneeAvatarUrl = (assignee.avatarUrl) || (userMap[assignee.email] ? userMap[assignee.email].avatarUrl : '') || '/default-avatar.png';
                const assigneeAvatarImg = `<img src="${assigneeAvatarUrl}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;
                
                workerHtml = `
                    <div style="margin-bottom:10px; font-size:13px; color:#004085; background:#cce5ff; padding:5px; border-radius:4px; border-left: 3px solid #007bff;">
                        🔧 KTV: <strong>${assigneeAvatarImg} ${assignee.name || assignee.email}</strong> đang sửa
                    </div>
                `;
                
                if (isManager) {
                     workerHtml += `
                        <div style="text-align:right; margin-bottom:5px;">
                            <button onclick="openAssignModal('REPAIR')" style="background:none; border:none; color:#007bff; cursor:pointer; font-size:12px; text-decoration:underline;">
                                🔄 Giao người khác
                            </button>
                        </div>`;
                }

            } else {
                if (isManager) {
                    workerHtml = `
                        <div style="margin-bottom:10px;">
                            <button onclick="openAssignModal('REPAIR')" class="btn-sm" style="background:#673ab7;">👉 Giao KTV Sửa Chữa</button>
                        </div>
                    `;
                } else {
                    workerHtml = `<div style="color:#999; margin-bottom:10px; font-style:italic;">(Chưa phân công KTV)</div>`;
                }
            }
            
            const showCompleteBtn = (t.assignedRepair && (t.assignedRepair.email === myEmail || isManager));
            const completeBtnHtml = showCompleteBtn 
                ? `<button onclick="openUpdateModal('repair')" class="btn-sm" style="background:#007bff; padding:10px 20px; font-size:14px;">✅ Báo Cáo Hoàn Tất</button>`
                : `<span style="font-size:12px; color:#999;">(Cần được giao việc để báo cáo)</span>`;

            repairBlock.innerHTML = `
                ${confirmInfo}
                <div style="text-align:center; padding:15px; border:2px dashed #ffc107; background:#fff3cd; border-radius:8px;">
                    <h4 style="margin-top:0; color:#856404;">🔧 Đang tiến hành sửa chữa...</h4>
                    ${workerHtml}
                    ${completeBtnHtml}
                    ${orderBtn} </div>
            `;
        }

    } else if (t.repair) {
        repairContainer.style.opacity = '1';
        
        const repairEmail = (t.assignedRepair && t.assignedRepair.email) || t.repair.technicianEmail;
        const repairInfo = userMap[repairEmail] || {};
        const repairName = (t.assignedRepair && t.assignedRepair.name) || repairInfo.name || repairEmail;
        const repairAvatarUrl = (t.assignedRepair && t.assignedRepair.avatarUrl) || repairInfo.avatarUrl || '/default-avatar.png';
        const repairAvatarImg = `<img src="${repairAvatarUrl}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;

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
                <div><strong>KTV:</strong> ${repairAvatarImg} ${repairName}</div> <div><strong>Công việc:</strong> ${t.repair.workDescription}</div>
                <div><strong>Bảo hành:</strong> ${t.repair.warranty || 'Không'}</div>
                ${photosHtml}
                <div style="font-size:11px; color:#666; margin-top:5px; text-align:right;">
                    ${new Date(t.repair.completionDate).toLocaleString('vi-VN')}
                </div>
            </div>
        `;

    } else if (t.currentStatus === 'Trả máy không sửa') {
        repairContainer.style.opacity = '1';
        repairBlock.innerHTML = `<div style="background:#f8d7da; color:#721c24; padding:10px; border-radius:6px; text-align:center;">❌ Khách không sửa. Chuyển sang trả máy.</div>`;

    } else {
        repairContainer.style.opacity = '0.6';
        repairBlock.innerHTML = '---';
    }

    const paymentContainer = document.getElementById('block_complete');
    const paymentBlock = document.getElementById('content_complete');
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

        const pStaffEmail = t.payment.staffEmail || '';
        const pStaffName = t.payment.staffName || '';
        const staffInfo = userMap[pStaffEmail] || {};
        const staffName = pStaffName || staffInfo.name || pStaffEmail || '---';
        const staffAvatar = `<img src="${staffInfo.avatarUrl || '/default-avatar.png'}" class="avatar-small" style="width:20px; height:20px; border-radius:50%;" alt="avt">`;

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
                    Thu ngân: <strong>${staffAvatar} ${staffName}</strong> - ${new Date(t.payment.date).toLocaleString('vi-VN')}
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
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    
    const steps = ['step_new', 'step_check', 'step_quote', 'step_repair', 'step_done'];
    let activeIndex = 0;
    const s = status ? status.toLowerCase() : '';

    if (s === 'mới nhận') activeIndex = 0;
    else if (s.includes('kiểm tra') || s.includes('chờ báo giá')) activeIndex = 1;
    else if (s.includes('đã báo giá') || s.includes('chờ khách')) activeIndex = 2;
    else if (s.includes('sửa') || s.includes('chờ đặt hàng') || s.includes('đã có hàng')) {
        activeIndex = 3;
    }
    else if (s.includes('hoàn tất') || s.includes('đã trả') || s.includes('chờ trả máy')) activeIndex = 4;
    
    // Update progress bar width
    const timeline = document.querySelector('.timeline-steps');
    if (timeline) {
        const progressWidth = activeIndex > 0 ? (activeIndex / (steps.length - 1)) * 100 : 0;
        timeline.style.setProperty('--progress-width', `${progressWidth}%`);
        // Use a fixed semi-transparent blue for the progress bar
        timeline.style.setProperty('--progress-color', 'rgba(33, 150, 243, 0.5)');
    }

    for (let i = 0; i <= activeIndex; i++) {
        const stepEl = document.getElementById(steps[i]);
        if(stepEl) stepEl.classList.add('active');
    }
}

function openUpdateModal(type) {
    currentTicketId = document.getElementById('d_ticketId').innerText;
    
    if (type === 'check') {
        document.getElementById('check_cause').value = '';
        document.getElementById('check_components').value = '';
        checkPhotos = [];
        document.getElementById('checkPhotoGrid').innerHTML = '';
        document.getElementById('modalTechCheck').style.display = 'flex';
    }
    else if (type === 'quote') {
        const techInfo = document.getElementById('content_techCheck').innerText;
        document.getElementById('quote_tech_summary').innerText = techInfo || 'Chưa có thông tin';

        document.getElementById('quoteItemsBody').innerHTML = '';
        
        const techSolution = currentTicketData.techCheck ? currentTicketData.techCheck.solution : '';

        if (techSolution === 'Không sửa được') {
            document.querySelector('input[name="quoteType"][value="INTERNAL"]').checked = true;
            toggleQuoteType();
            addQuoteRow("Phí kiểm tra (Trả máy không sửa)", 1, 0);
            document.getElementById('quote_warranty').value = 'Không';
            document.getElementById('quote_notes').value = 'Máy không sửa được, gửi lại khách.';
        } else {
            const radioExternal = document.querySelector('input[name="quoteType"][value="EXTERNAL"]');
            const radioInternal = document.querySelector('input[name="quoteType"][value="INTERNAL"]');

            if (techSolution === 'Gửi sửa ngoài' || techSolution === 'Gửi hãng') {
                 radioExternal.checked = true;
                 if (currentTicketData.externalLogistics && currentTicketData.externalLogistics.unitName) {
                        setTimeout(() => {
                            document.getElementById('q_ext_unit').value = currentTicketData.externalLogistics.unitName;
                        }, 0);
                    }
                } else {
                 radioInternal.checked = true;
            }
            toggleQuoteType();

            if (currentTicketData && currentTicketData.quotation) {
                const q = currentTicketData.quotation;
                
                if (q.type === 'EXTERNAL') {
                     radioExternal.checked = true;
                } else {
                     radioInternal.checked = true;
                }
                toggleQuoteType();
                
                if (q.items && q.items.length > 0) {
                    q.items.forEach(item => {
                        addQuoteRow(item.name, item.qty, item.price, item.cost);
                    });
                } else {
                    addQuoteRow(); 
                }

                document.getElementById('quote_warranty').value = q.warranty || '';
                document.getElementById('quote_notes').value = q.notes || '';
                
                if (q.externalInfo) {
                    document.getElementById('q_ext_unit').value = q.externalInfo.unit || '';
                    document.getElementById('q_ext_ship').value = q.externalInfo.shippingFee || '';
                }
            } else {
                addQuoteRow();
                document.getElementById('quote_warranty').value = '';
                document.getElementById('quote_notes').value = '';
                document.getElementById('q_ext_unit').value = '';
                document.getElementById('q_ext_ship').value = '';
            }
        }

        calculateQuoteTotal();
        document.getElementById('modalQuote').style.display = 'flex';
    }
    else if (type === 'repair') {
        document.getElementById('repair_work').value = '';
        repairPhotos = [];
        document.getElementById('repairPhotoGrid').innerHTML = '';
        document.getElementById('modalRepair').style.display = 'flex';
    }
    else if (type === 'return') {
        let finalPrice = 0;

        const confirm = currentTicketData.customerConfirm;
        const isAgreedToRepair = confirm && confirm.result === 'Đồng ý sửa';

        if (isAgreedToRepair && currentTicketData.quotation) {
            finalPrice = currentTicketData.quotation.totalPrice || currentTicketData.quotation.price || 0;
        }
        
        const priceEl = document.getElementById('return_quote_price');
        priceEl.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(finalPrice);
        priceEl.style.color = finalPrice > 0 ? '#2e7d32' : '#d32f2f'; 
        
        document.getElementById('return_amount').value = finalPrice;
        
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

    document.querySelectorAll('#quoteItemsBody tr').forEach(tr => {
        const name = tr.querySelector('.q-name').value.trim();
        const qty = parseFloat(tr.querySelector('.q-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.q-price').value) || 0;
        const cost = parseFloat(tr.querySelector('.q-cost').value) || 0;

        if (name) {
            items.push({ name, qty, price, cost });
        }
    });

    if (items.length === 0) {
        Swal.fire('Thiếu thông tin', 'Vui lòng nhập ít nhất 1 linh kiện/dịch vụ.', 'warning');
        return;
    }

    const totalPrice = calculateQuoteTotal();
    const warranty = document.getElementById('quote_warranty').value.trim();
    const notes = document.getElementById('quote_notes').value.trim();
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
            totalPrice: totalPrice,
            warranty: warranty,
            notes: notes,
            quoteType: quoteType,
            externalInfo: externalData
        }
    };
    
    Swal.fire({ title: 'Đang gửi...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', 'Đã gửi báo giá thành công!', 'success');
            closeModal('modalQuote');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
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
    
    if (!cause) {
        Swal.fire('Thiếu thông tin', 'Vui lòng nhập nguyên nhân lỗi.', 'warning');
        return;
    }

    Swal.fire({ title: 'Đang lưu...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
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
        
        Swal.fire('Thành công', 'Cập nhật kiểm tra thành công!', 'success');
        closeModal('modalTechCheck');
        viewTicketDetail(currentTicketId);

    } catch (err) {
        Swal.fire('Lỗi', err.message, 'error');
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
                <span class="material-icons">delete</span>
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
    
    const { value: note, isConfirmed } = await Swal.fire({
        title: `Xác nhận: ${actionName}?`,
        input: 'textarea',
        inputPlaceholder: 'Nhập ghi chú (nếu có)...',
        showCancelButton: true,
        confirmButtonText: 'Xác nhận',
        cancelButtonText: 'Hủy'
    });
    
    if (!isConfirmed) return;

    const data = {
        ticketId: currentTicketId,
        action: 'CUSTOMER_CONFIRM',
        data: {
            isAgreed: isAgreed,
            note: note || ''
        }
    };

    Swal.fire({ title: 'Đang cập nhật...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', `Đã cập nhật trạng thái: ${actionName}`, 'success');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
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
    const warranty = (currentTicketData.quotation && currentTicketData.quotation.warranty) 
                     ? currentTicketData.quotation.warranty 
                     : "Theo quy định";
    
    if (!work) {
        Swal.fire('Thiếu thông tin', 'Vui lòng nhập nội dung công việc đã làm.', 'warning');
        return;
    }

    Swal.fire({ title: 'Đang xử lý...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
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
        
        Swal.fire('Thành công', 'Đã cập nhật trạng thái: Sửa xong / Chờ trả máy!', 'success');
        closeModal('modalRepair');
        viewTicketDetail(currentTicketId);

    } catch(err) {
        Swal.fire('Lỗi', err.message, 'error');
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

    if (!amount) { Swal.fire('Thiếu thông tin', 'Vui lòng nhập số tiền thực thu.', 'warning'); return; }
    if (!ticketNum) { Swal.fire('Thiếu thông tin', 'Vui lòng nhập Số sổ 3 liên.', 'warning'); return; }

    Swal.fire({ title: 'Đang thanh toán...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
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
        
        Swal.fire('Thành công', 'Đã trả máy thành công! Phiếu đã hoàn tất.', 'success');
        closeModal('modalReturn');
        viewTicketDetail(currentTicketId);

    } catch (err) {
        Swal.fire('Lỗi', err.message, 'error');
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
    
    if (total <= 0) { Swal.fire('Thiếu thông tin', 'Vui lòng nhập chi phí.', 'warning'); return; }

    document.getElementById('quoteItemsBody').innerHTML = '';
    const serviceName = `Sửa chữa (Gửi ${unit || 'đối tác'})`;
    addQuoteRow(serviceName, 1, total);
}
// Mở Modal Gửi/Nhận
function openExternalModal(type) {
    const techSolution = currentTicketData.techCheck ? currentTicketData.techCheck.solution : '';
    const isWarranty = techSolution === 'Gửi hãng';
    
    if (type === 'SEND') {
        const titleEl = document.querySelector('#modalExtSend h3');
        if (titleEl) titleEl.innerText = isWarranty ? '🛡️ Gửi Máy Đi Bảo Hành' : '🚚 Gửi Máy Đi Sửa Ngoài';

        let unitName = '';
        if (currentTicketData.quotation && currentTicketData.quotation.externalInfo) {
            unitName = currentTicketData.quotation.externalInfo.unit;
        }
        document.getElementById('ext_send_unit').value = unitName;
        document.getElementById('ext_send_note').value = '';
        document.getElementById('modalExtSend').style.display = 'flex';
    } 
    else if (type === 'RECEIVE') {
        const confirm = currentTicketData.customerConfirm;
        const isDeclined = confirm && (confirm.result.includes('Không sửa') || confirm.result.includes('Từ chối'));

        const titleEl = document.querySelector('#modalExtReceive h3');
        const pEl = document.querySelector('#modalExtReceive p');
        const qcSelect = document.getElementById('ext_qc_result');
        const qcLabel = qcSelect.previousElementSibling; 
        
        const allLabels = document.querySelectorAll('#modalExtReceive label');
        const noteLabelEl = allLabels[allLabels.length - 1];

        const btnSubmit = document.querySelector('#modalExtReceive button[onclick*="submitExternalAction"]');

        if (isDeclined) {
            titleEl.innerText = '↩️ Nhận Máy Về (Khách Hủy)';
            pEl.innerText = 'Máy khách không sửa. Xác nhận nhận lại từ đối tác.';
            
            if(qcSelect) qcSelect.style.display = 'none';
            if(qcLabel) qcLabel.style.display = 'none';
            if(noteLabelEl) noteLabelEl.innerText = 'Tình trạng máy khi nhận lại:';
            btnSubmit.innerText = 'Đã Nhận Về Kho';
            btnSubmit.style.background = '#546e7a';
        } else {
            titleEl.innerText = '✅ Nhận Máy & Kiểm Tra (QC)';
            pEl.innerText = 'Máy đã được gửi trả về. Kỹ thuật viên cần kiểm tra lại.';
            if(qcSelect) qcSelect.style.display = 'block';
            if(qcLabel) qcLabel.style.display = 'block';
            if(noteLabelEl) noteLabelEl.innerText = 'Ghi chú kiểm tra:';
            btnSubmit.innerText = 'QC Đạt - Chờ Trả Khách';
            btnSubmit.style.background = '#28a745';
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

    Swal.fire({ title: 'Đang cập nhật...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', 'Cập nhật trạng thái thành công!', 'success');
            closeModal('modalExtSend');
            closeModal('modalExtReceive');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
}
/**
 * [SALE/ADMIN] Kích hoạt trạng thái Chờ Đặt Hàng
 */
async function triggerOrderParts() {
    const { value: note, isConfirmed } = await Swal.fire({
        title: 'Đặt Linh Kiện',
        input: 'text',
        inputPlaceholder: 'Tên linh kiện, nhà cung cấp...',
        showCancelButton: true,
        confirmButtonText: 'Xác nhận Đặt',
        cancelButtonText: 'Hủy'
    });

    if (!isConfirmed) return;

    Swal.fire({ title: 'Đang xử lý...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const data = {
        ticketId: currentTicketId,
        action: 'ORDER_PARTS',
        data: { note: note || '' }
    };

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', 'Đã chuyển sang trạng thái: Chờ đặt hàng.', 'success');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
}

/**
 * [SALE/ADMIN/KHO] Xác nhận Đã Có Hàng
 */
async function triggerPartsArrived() {
    const { isConfirmed } = await Swal.fire({
        title: 'Xác Nhận Có Hàng?',
        text: "Xác nhận linh kiện đã về kho và sẵn sàng để sửa?",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Đúng, đã có hàng!',
        cancelButtonText: 'Chưa'
    });

    if (!isConfirmed) return;

    Swal.fire({ title: 'Đang cập nhật...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const data = {
        ticketId: currentTicketId,
        action: 'PARTS_ARRIVED',
        data: {}
    };

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', 'Đã cập nhật. KTV có thể bắt đầu sửa.', 'success');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
}

async function openAssignModal(step) {
    currentAssignStep = step;
    const select = document.getElementById('assign_tech_select');
    select.innerHTML = '<option>Đang tải...</option>';
    
    document.getElementById('modalAssign').style.display = 'flex';

    try {
        const techs = await callApi('/public/technicians');
        
        select.innerHTML = '<option value="">-- Chọn KTV --</option>';
        techs.forEach(t => {
            const option = document.createElement('option');
            option.value = t.email;
            const techName = t.name || t.email;
            const avatarUrl = t.avatarUrl || '/default-avatar.png';
            option.dataset.avatar = avatarUrl;
            option.innerText = techName;
            select.appendChild(option);
        });
    } catch (err) {
        Swal.fire('Lỗi', 'Không thể tải danh sách Kỹ thuật viên.', 'error');
        closeModal('modalAssign');
    }
}

async function submitAssignWork() {
    const techEmail = document.getElementById('assign_tech_select').value;
    if (!techEmail) {
        Swal.fire('Chưa chọn', 'Vui lòng chọn một KTV để giao việc.', 'warning');
        return;
    }

    const techName = document.querySelector('#assign_tech_select option:checked').innerText;
    const avatarUrl = document.querySelector('#assign_tech_select option:checked').dataset.avatar;

    const data = {
        ticketId: currentTicketId,
        action: `ASSIGN_${currentAssignStep}`,
        data: {
            techEmail: techEmail,
            techName: techName,
            techAvatarUrl: avatarUrl
        }
    };
    
    Swal.fire({ title: 'Đang giao việc...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    callApi('/repair/update', data)
        .then(() => {
            Swal.fire('Thành công', `Đã giao việc cho ${techName}`, 'success');
            closeModal('modalAssign');
            viewTicketDetail(currentTicketId);
        })
        .catch(err => Swal.fire('Lỗi', err.message, 'error'));
}

function handleAssignSelection() {
    const select = document.getElementById('assign_tech_select');
    const selectedOption = select.options[select.selectedIndex];
    const preview = document.getElementById('assign_selection_preview');

    if (select.value) {
        document.getElementById('assign_avatar_preview').src = selectedOption.dataset.avatar || '/default-avatar.png';
        document.getElementById('assign_tech_name').innerText = selectedOption.innerText;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}
document.getElementById('assign_tech_select').addEventListener('change', handleAssignSelection);

function printTicket() {
    if (!currentTicketData) {
        Swal.fire('Lỗi', 'Không có dữ liệu phiếu để in.', 'error');
        return;
    }
    const t = currentTicketData;
    const printWindow = window.open('', '_blank');
    printWindow.document.write('<html><head><title>Biên Nhận Sửa Chữa</title>');
    printWindow.document.write('<style>body{font-family: Arial, sans-serif; margin: 20px;} table{width: 100%; border-collapse: collapse;} td,th{padding: 8px; border: 1px solid #ddd; text-align: left;} .header{text-align: center; margin-bottom: 20px;} .logo{height: 50px;} h2{margin-top: 0;} .qr-code{width: 100px; height: 100px;}</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(`<div class="header"><h2>Biên Nhận Sửa Chữa</h2><p>Mã phiếu: <strong>${t.ticketId}</strong></p></div>`);
    printWindow.document.write('<h3>Thông Tin Khách Hàng</h3>');
    printWindow.document.write(`<table><tr><td>Tên</td><td>${t.customerName}</td></tr><tr><td>SĐT</td><td>${t.customerPhone}</td></tr><tr><td>Địa chỉ</td><td>${t.customerAddress || ''}</td></tr></table>`);
    printWindow.document.write('<h3>Thông Tin Thiết Bị</h3>');
    printWindow.document.write(`<table><tr><td>Loại</td><td>${t.deviceType}</td></tr><tr><td>Hãng/Model</td><td>${t.deviceBrand} ${t.deviceModel}</td></tr><tr><td>Serial</td><td>${t.deviceSerial || ''}</td></tr><tr><td>Phụ kiện</td><td>${(t.accessories || []).join(', ') || 'Không'}</td></tr></table>`);
    printWindow.document.write('<h3>Tình Trạng</h3>');
    printWindow.document.write(`<p><strong>Lỗi khách báo:</strong> ${t.issueDescription}</p>`);
    printWindow.document.write(`<p><strong>Ngoại hình:</strong> ${t.physicalCondition || 'Bình thường'}</p>`);
    printWindow.document.write(`<p><strong>Ngày nhận:</strong> ${new Date(t.createdAt).toLocaleString('vi-VN')}</p>`);
    printWindow.document.write('<hr><p style="font-size:12px; text-align:center;">Cảm ơn quý khách đã sử dụng dịch vụ!</p>');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
}
function printDeviceLabel() {
     if (!currentTicketData) {
        Swal.fire('Lỗi', 'Không có dữ liệu phiếu để in tem.', 'error');
        return;
    }
    const t = currentTicketData;
    const printWindow = window.open('', '_blank', 'width=300,height=200');
    printWindow.document.write('<html><head><title>Tem Dán</title>');
    printWindow.document.write('<style>body{font-family: Arial, sans-serif; text-align: center; margin: 5px; font-size: 10px;} h4, p{margin: 3px 0;}</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(`<h4>${t.ticketId}</h4>`);
    printWindow.document.write(`<p>${t.customerName}</p>`);
    printWindow.document.write(`<p>${t.deviceBrand} ${t.deviceModel}</p>`);
    printWindow.document.write(`<p>Ngày: ${new Date(t.createdAt).toLocaleDateString('vi-VN')}</p>`);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
     setTimeout(() => { printWindow.print(); }, 500);
}
