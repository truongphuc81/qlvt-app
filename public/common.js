// public/common.js (FILE MỚI)

// === API VÀ CÁC HÀM DÙNG CHUNG ===

const API_BASE_URL = 'https://us-central1-quan-ly-vat-tu-backend.cloudfunctions.net/app/api';

/**
 * Hiển thị thông báo thành công
 */
function showSuccess(id, msg) {
    var e = document.getElementById(id);
    if (e) {
        e.innerText = msg;
        e.style.display = 'block';
        setTimeout(function() { e.style.display = 'none'; }, 5000);
    }
}

/**
 * Hiển thị thông báo lỗi
 */
function showError(id, msg) {
    var e = document.getElementById(id);
    if (e) {
        e.innerText = msg;
        e.style.display = 'block';
        setTimeout(function() { e.style.display = 'none'; }, 5000);
    }
}

/**
 * Chuẩn hóa mã vật tư
 */
function normalizeCode(code) {
    return (code || '').toString().trim().toLowerCase();
}

/**
 * Bật/tắt Dark Mode
 */
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

/**
 * Bật/tắt Card View
 */
function toggleTableView() {
    const body = document.body;
    const isCardView = body.classList.toggle('card-view-mobile');
    localStorage.setItem('tableView', isCardView ? 'card' : 'scroll');
}

/**
 * Lấy Firebase ID Token của user
 */
async function getFirebaseIdToken() {
    const user = auth.currentUser;
    if (user) {
        return user.getIdToken(true); // Luôn lấy token mới
    }
    return null;
}

/**
 * Hàm gọi API (Wrapper)
 */
async function callApi(endpoint, data) {
    console.log(`Calling API: ${endpoint}`);
    try {
        const idToken = await getFirebaseIdToken();

        const headers = {
            'Content-Type': 'application/json',
        };
        if (idToken) {
            headers['Authorization'] = 'Bearer ' + idToken;
        } else {
            // Nếu không có token VÀ endpoint không phải public -> Lỗi
            // (Chúng ta giả định API public sẽ được kiểm tra ở logic gọi)
            if (!endpoint.startsWith('/public/')) {
                 console.warn(`User not logged in for protected endpoint: ${endpoint}`);
                 // Không đăng xuất ở đây, để mỗi trang tự xử lý
                 throw new Error('Yêu cầu xác thực. Vui lòng đăng nhập lại.');
            }
        }

        const res = await fetch(API_BASE_URL + endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        const text = await res.text();
        
        if (!res.ok) {
            // Cố gắng parse lỗi JSON từ text
            try {
                const jsonError = JSON.parse(text);
                throw new Error(jsonError.error || text);
            } catch (e) {
                // Nếu không phải JSON, ném text thô
                throw new Error(text || `Lỗi HTTP! Status: ${res.status}`);
            }
        }

        if (!text) return { ok: true }; // Trả về mặc định nếu body rỗng

        return JSON.parse(text); // Parse JSON thành công

    } catch (error) {
         console.error(`API Call failed for ${endpoint}:`, error);
         throw error;
    }
}

/**
 * [NÂNG CẤP] Nén và cắt ảnh đại diện thành hình vuông.
 * @param {File} file - File ảnh gốc.
 * @param {number} outputSize - Kích thước cạnh của ảnh vuông đầu ra (VD: 400).
 * @param {number} quality - Chất lượng ảnh JPEG (0.1 - 1.0).
 * @returns {Promise<Blob>} - Trả về một Blob chứa ảnh đã được xử lý.
 */
function compressAndCropImage(file, outputSize, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Xác định kích thước và vị trí cắt (crop) từ tâm
                let sourceX, sourceY, sourceSize;
                if (img.width > img.height) {
                    // Ảnh ngang
                    sourceSize = img.height;
                    sourceX = (img.width - img.height) / 2;
                    sourceY = 0;
                } else {
                    // Ảnh dọc hoặc vuông
                    sourceSize = img.width;
                    sourceX = 0;
                    sourceY = (img.height - img.width) / 2;
                }

                // Thiết lập kích thước canvas là kích thước vuông đầu ra
                canvas.width = outputSize;
                canvas.height = outputSize;

                // Vẽ phần ảnh đã được cắt vào canvas và resize
                ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);

                // Chuyển canvas thành Blob
                canvas.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Không thể tạo Blob từ canvas.'));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = error => reject(new Error('Không thể tải ảnh vào Image object.'));
        };
        reader.onerror = error => reject(new Error('Không thể đọc file ảnh.'));
    });
}

/**
 * [GIỮ LẠI] Hàm nén ảnh cũ để dùng cho các chức năng khác (không cắt vuông).
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