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