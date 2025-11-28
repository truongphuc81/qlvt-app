// functions/index.js (FINAL - Cấu trúc Router Chính xác)

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const express = require('express');
const cors = require('cors');

// Import logic nghiệp vụ
const dataProcessor = require('./data-processor');
console.log('!!! INDEX.JS - LATEST VERSION RUNNING !!!');
// Khai báo ID Sheets
const SPREADSHEET_ID = '1vzhV7X-mBEG8tIqYg-JTTCMkbEYX9RDJbYczZIaOTK0'; 

// 1. KHỞI TẠO FIREBASE ADMIN SDK
admin.initializeApp();
const db = admin.firestore(); // Firestore Client
let dbInstance = null; // Biến lưu trữ kết nối Firestore
const getDb = () => {
    if (!dbInstance) {
        console.log("Initializing Firestore instance..."); // Thêm log
        dbInstance = admin.firestore(); // Tạo kết nối nếu chưa có
    }
    return dbInstance; // Trả về kết nối đã có hoặc vừa tạo
};
// === KẾT THÚC HÀM getDb ===
// 2. KHỞI TẠO GOOGLE SHEETS API CLIENT
const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/cloud-platform']
});
const sheets = google.sheets({ version: 'v4', auth }); // Khởi tạo Sheets Client


// 3. THIẾT LẬP EXPRESS APP VÀ MIDDLEWARE
const app = express();
app.use(cors({
  origin: [
    'https://khodotnet.store',
    'https://quan-ly-vat-tu-backend.web.app',
    'quan-ly-vat-tu-backend.firebaseapp.com',
    'http://localhost:5000',
    'http://localhost:5173'
  ]
}));
app.use(express.json());

//const textToSpeech = require('@google-cloud/text-to-speech'); // <-- THÊM DÒNG NÀY

// ... (khởi tạo app, auth, sheets) ...
//const ttsClient = new textToSpeech.TextToSpeechClient(); // <-- THÊM DÒNG NÀY

// =======================================================
// MIDDLEWARE XÁC THỰC (Được áp dụng cho các API yêu cầu Auth)
// =======================================================
const authenticate = async (req, res, next) => {
    const idToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;

    if (!idToken) {
        return res.status(401).send({ error: 'Unauthorized: Authentication required.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userEmail = decodedToken.email;

        // *** BẮT ĐẦU NÂNG CẤP ***

        // 1. Lấy quyền (roles) trực tiếp từ token
        // Chúng ta sẽ định nghĩa 3 vai trò: admin, inventory_manager, auditor
        const roles = {
            admin: !!decodedToken.admin,
            inventory_manager: !!decodedToken.inventory_manager,
            auditor: !!decodedToken.auditor,
            sale: !!decodedToken.sale
        };

        // 2. Không cần gọi dataProcessor.checkManager (Google Sheet) nữa

        // 3. Đưa thông tin người dùng và quyền vào req.user
        req.user = {
            email: userEmail,
            uid: decodedToken.uid, // UID rất quan trọng
            roles: roles, // Object chứa các quyền

            // Giữ isManager để tương thích code cũ ở frontend
            // Admin HOẶC Quản lý kho đều được coi là "Manager"
            isManager: roles.admin || roles.inventory_manager,

            // Admin cũng là Auditor
            isAuditor: roles.admin || roles.auditor
        };

        // *** KẾT THÚC NÂNG CẤP ***

        return next();

    } catch (e) {
        console.error('Token Verification Failed:', e.stack);
        return res.status(401).send({ error: 'Invalid authentication token: ' + e.message });
    }
};
// Middleware: Chỉ cho phép Admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.roles.admin) {
        return next();
    }
    return res.status(403).send({ error: 'Forbidden: Yêu cầu quyền Admin.' });
};

// Middleware: Cho phép Admin HOẶC Inventory Manager (Chỉ để duyệt mượn)
const canApproveBorrowsOrAdmin = (req, res, next) => {
    if (req.user && (req.user.roles.admin || req.user.roles.inventory_manager)) {
        return next();
    }
    return res.status(403).send({ error: 'Forbidden: Yêu cầu quyền Quản lý kho hoặc Admin.' });
};

// Middleware: Cho phép Admin HOẶC Auditor (Cho trang kiểm duyệt)
const isAuditorOrAdmin = (req, res, next) => {
    if (req.user && (req.user.roles.admin || req.user.roles.auditor)) {
        return next();
    }
    return res.status(403).send({ error: 'Forbidden: Yêu cầu quyền Kiểm duyệt viên.' });
};

// =======================================================
// 4. ĐỊNH TUYẾN API ENDPOINTS
// =======================================================
// File: functions/index.js (Sửa hàm apiWrapper)
const apiWrapper = (handler) => async (req, res, next) => {
    try {
        // <<< THÊM DÒNG LOG NÀY >>>
        console.log(`[apiWrapper ENTRY] Request received for path: ${req.path}, Method: ${req.method}`); 

        const context = { // Build context
            db: db, 
            sheets: sheets, 
            spreadsheetId: SPREADSHEET_ID,
            user: req.user, 
            body: req.body,
            query: req.query,
            params: req.params
        };
        // Log trước khi gọi handler
        console.log(`[apiWrapper PRE-HANDLER] Context built for: ${req.path}`); 
        const result = await handler(context);
        // Log sau khi handler trả về
        console.log(`[apiWrapper POST-HANDLER] Handler finished for: ${req.path}`); 
        res.json(result || { ok: true }); // Default success response
    } catch (error) {
        console.error(`[!!! apiWrapper ERROR !!!] Path: ${req.path} - Error: ${error.message}`, error); // Log lỗi chi tiết hơn
        res.status(500).json({ error: error.message || 'An unexpected error occurred.' });
    }
};


// --- ROUTER 1: PUBLIC AUTH ROUTES ---
const authRouter = express.Router();

authRouter.post('/verifyAndRegister', apiWrapper(async ({ db, body }) => { // <-- SỬA Ở ĐÂY
    return dataProcessor.verifyAndRegisterUser({ 
        db, // <-- SỬA Ở ĐÂY
        email: body.email, 
        name: body.name 
    });
}));
// GẮN ROUTER AUTH CÔNG KHAI VÀO APP.USE
app.use('/api/auth', authRouter); 


// functions/index.js

// --- ROUTER 2: PRIVATE (CẦN AUTHENTICATE) ---
const privateRouter = express.Router();
privateRouter.use(authenticate); // Áp dụng Auth cho TẤT CẢ TUYẾN ĐƯỜNG PRIVATE

// 4a. Dashboard Data (Ai cũng được xem của mình)
privateRouter.post('/dashboard', apiWrapper(async ({ sheets, spreadsheetId, db, user, body }) => {
    // Hàm này cần email của KTV, được gửi từ body
    if (!body.technicianEmail) {
        throw new Error('Thiếu technicianEmail trong body.');
    }
    return dataProcessor.getTechnicianDashboardData({ 
        db, 
        sheets, 
        spreadsheetId, 
        email: body.technicianEmail 
    });
}));

// 4b. Lịch sử Mượn 
privateRouter.post('/history/byemail', apiWrapper(async ({ sheets, spreadsheetId, db, body, user }) => {
    return dataProcessor.getBorrowHistory({ 
        db, 
        email: body.email, 
        dateStr: body.date, 
        isLast5Days: body.isLast5Days, 
        currentPage: body.currentPage, 
        pageSize: body.pageSize 
    });
}));

// 4c. Submit Lệnh Mượn (KTV)
privateRouter.post('/submit/borrow', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    // Hàm submitTransaction đã xử lý logic 'Mượn'
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4d. Submit Lệnh Trả (KTV) 
privateRouter.post('/submit/return', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    // Hàm submitTransaction đã xử lý logic 'Trả' (Đối chiếu sổ)
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4e. Submit Báo cáo Sai sót (KTV) 
privateRouter.post('/submit/errorReport', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.submitErrorReport({ sheets, spreadsheetId, data: body });
}));
// ==========================================================
// === CÁC API CỦA QUẢN LÝ - PHÂN QUYỀN NGHIÊM NGẶT ===
// ==========================================================

// === QUYỀN: Admin HOẶC Inventory_Manager (Chỉ liên quan đến duyệt MƯỢN) ===

// 4h. Gửi Vật tư Mượn (Duyệt lệnh mượn)
privateRouter.post('/manager/submitBorrow', canApproveBorrowsOrAdmin, apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4p. Từ chối Note Mượn hàng
privateRouter.post('/manager/rejectBorrowNote', canApproveBorrowsOrAdmin, apiWrapper(async ({ db, body }) => {
    return dataProcessor.rejectBorrowNote({ db, data: body });
}));

// 4f. Danh sách Kỹ thuật viên (Cần để chọn KTV)
privateRouter.post('/manager/technicians', canApproveBorrowsOrAdmin, apiWrapper(async ({ db }) => { // <-- SỬA Ở ĐÂY
    return dataProcessor.getTechnicians({ db }); // <-- SỬA Ở ĐÂY
}));

// 4g. Danh mục vật tư (Cần để tìm vật tư)
privateRouter.post('/manager/items', canApproveBorrowsOrAdmin, apiWrapper(async ({ sheets, spreadsheetId }) => {
    return dataProcessor.getItemList({ sheets, spreadsheetId });
}));

// 4q. Lấy số lượng yêu cầu đang chờ (Cần để xem thông báo)
privateRouter.post('/manager/pendingCounts', canApproveBorrowsOrAdmin, apiWrapper(async ({ db }) => {
    return dataProcessor.getPendingCounts({ db });
}));

// === QUYỀN: CHỈ ADMIN (Tất cả các chức năng còn lại) ===

// 4i. Xác nhận Đối chiếu (Duyệt trả) - ĐÃ MỞ QUYỀN
privateRouter.post('/manager/submitReturn', canApproveBorrowsOrAdmin, apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4n. Từ chối Note Trả hàng - ĐÃ MỞ QUYỀN
privateRouter.post('/manager/rejectReturnNote', canApproveBorrowsOrAdmin, apiWrapper(async ({ db, body }) => {
    return dataProcessor.rejectReturnNote({ db, data: body });
}));

// [MỚI] API LẤY TỔNG QUAN TOÀN HỆ THỐNG
privateRouter.post('/manager/global-overview', isAdmin, apiWrapper(async ({ db, sheets, spreadsheetId }) => {
    return dataProcessor.getGlobalInventoryOverview({ db, sheets, spreadsheetId });
}));

// === DÁN VÀO ĐÂY ===
// [MỚI] API SỬA KHO ÂM
privateRouter.post('/manager/fix-negative-inventory', isAdmin, apiWrapper(async ({ db, sheets, spreadsheetId, body }) => {
    const { email, itemCode, itemName, amount } = body;
    if (!email || !itemCode || !amount) {
        throw new Error('Thiếu thông tin email, vật tư, hoặc số lượng.');
    }
    return dataProcessor.fixNegativeInventory({ 
        db, sheets, spreadsheetId, 
        email, itemCode, itemName, 
        amountToFix: amount 
    });
}));

// === DÁN VÀO ĐÂY ===
// [MỚI] API SỬA KHO ÂM (HÀNG LOẠT)
privateRouter.post('/manager/fix-negative-inventory-batch', isAdmin, apiWrapper(async ({ db, sheets, spreadsheetId, body }) => {
    const { email, items } = body;
    if (!email || !items || !Array.isArray(items)) {
        throw new Error('Thiếu email hoặc danh sách vật tư.');
    }
    return dataProcessor.fixNegativeInventoryBatch({ 
        db, sheets, spreadsheetId, 
        email: email, 
        itemsToFix: items
    });
}));
// 4o. Chuyển vật tư
privateRouter.post('/manager/transferItems', isAdmin, apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
  return dataProcessor.managerTransferItems({ sheets, spreadsheetId, db, data: body });
}));

// 4j. Tải Dải Số Sổ
privateRouter.post('/manager/ticketRanges', isAdmin, apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.getTicketRanges({ sheets, spreadsheetId, email: body.email });
}));

// 4k. Lưu Dải Số Sổ
privateRouter.post('/manager/saveTicketRanges', isAdmin, apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.saveTicketRanges({ sheets, spreadsheetId, email: body.email, ranges: body.ranges });
}));

// 4l. Xử lý Upload Excel
privateRouter.post('/manager/processExcelData', isAdmin, apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.processExcelData({ sheets, spreadsheetId, data: body.data });
}));

// 4m. Lưu Dữ liệu Excel đã Xử lý
privateRouter.post('/manager/saveExcelData', isAdmin, apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.saveExcelData({ sheets, spreadsheetId, db, data: body.data });
}));


// ==========================================================
// === CÁC API HỆ THỐNG VÀ AUDITOR ===
// ==========================================================

// 4p. TTS (Ai cũng dùng được)
privateRouter.post('/tts/speak', apiWrapper(async ({ body }) => {
    // Lấy text từ body mà app.js gửi lên
    const text = body.text;
    if (!text) {
        throw new Error('Thiếu "text" trong body.');
    }

    // Gọi hàm getSpeechAudio (trong data-processor.js)
    return dataProcessor.getSpeechAudio({ text: text });
}));

// === THÊM ENDPOINT MỚI ĐỂ LẤY QUYỀN ===
// (Thay thế cho /auth/checkRoles cũ)
privateRouter.post('/auth/getSelfRoles', apiWrapper(async ({ user }) => {
    // Middleware 'authenticate' đã lấy 'roles' từ token
    // Chúng ta chỉ cần trả nó về cho frontend
    return user.roles;
}));
/**
 * [MỚI] API công khai (cho người đã đăng nhập) để tải danh sách KTV
 * (Dùng cho bộ lọc của trang Auditor)
 */
privateRouter.post('/public/technicians', apiWrapper(async ({ db }) => {
    // Dùng hàm getTechnicians({db}) đọc từ Firestore
    return dataProcessor.getTechnicians({ db }); 
}));
// === THÊM ENDPOINT MỚI ĐỂ ADMIN GÁN QUYỀN ===
privateRouter.post('/admin/setRole', isAdmin, apiWrapper(async ({ user: adminUser, body }) => {
    const { email, roles } = body; // VD: email: 'user@abc.com', roles: { inventory_manager: true, auditor: false }
    
    if (!email || !roles) {
        throw new Error('Thiếu email hoặc object roles.');
    }
    
    try {
        const user = await admin.auth().getUserByEmail(email);
        const currentClaims = user.customClaims || {};
        
        // Tạo object claims mới một cách an toàn
        // Chỉ cập nhật các key mà chúng ta quản lý
        const newClaims = {
            ...currentClaims, // Giữ lại claims cũ (như 'admin' nếu user là admin)
            inventory_manager: !!roles.inventory_manager, // Ép kiểu boolean
            auditor: !!roles.auditor, // Ép kiểu boolean
            sale: !!roles.sale
        };

        // Admin không thể tự tước quyền admin của mình qua API này
        if (user.uid === adminUser.uid) { // adminUser là admin đang gọi
             newClaims.admin = true; // Đảm bảo admin luôn là admin
        }

        // Set claims mới cho user
        await admin.auth().setCustomUserClaims(user.uid, newClaims);
        
        return { ok: true, message: `Đã cập nhật quyền cho ${email}.`, newClaims: newClaims };
    } catch (e) {
        console.error("Lỗi set role:", e);
        throw new Error(`Không thể set role: ${e.message}`);
    }
}));
// [MỚI] Lấy danh sách quyền của một user (theo email)
privateRouter.post('/admin/getUserRoles', isAdmin, apiWrapper(async ({ body }) => {
    const { email } = body;
    if (!email) throw new Error('Thiếu email.');

    try {
        const user = await admin.auth().getUserByEmail(email);
        return user.customClaims || {}; // Trả về toàn bộ quyền
    } catch (e) {
        // Nếu không tìm thấy user
        if (e.code === 'auth/user-not-found') {
            throw new Error(`Không tìm thấy tài khoản với email: ${email}`);
        }
        throw e;
    }
}));

// [MỚI] API Cập nhật ảnh đại diện
privateRouter.post('/admin/setAvatar', isAdmin, apiWrapper(async ({ db, body }) => {
    return dataProcessor.updateTechnicianAvatar({ db, email: body.email, avatarUrl: body.avatarUrl });
}));

// [REPAIR] Tạo phiếu mới
// (Cho phép user đã đăng nhập là được tạo, không cần quyền Admin)
privateRouter.post('/repair/create', apiWrapper(async ({ db, body, user }) => {
    // Gán thêm email người tạo từ token để bảo mật
    const data = { ...body, creatorEmail: user.email };
    return dataProcessor.createRepairTicket({ db, data: data });
}));
// [REPAIR] Lấy danh sách phiếu
privateRouter.post('/repair/list', apiWrapper(async ({ db, body }) => {
    return dataProcessor.getRepairTickets({ 
        db, 
        status: body.status, 
        search: body.search 
    });
}));
// [REPAIR] Lấy chi tiết phiếu
privateRouter.post('/repair/detail', apiWrapper(async ({ db, body }) => {
    return dataProcessor.getRepairTicket({ 
        db, 
        ticketId: body.ticketId 
    });
}));
// [REPAIR] Cập nhật phiếu (Kiểm tra, Báo giá, Sửa...)
privateRouter.post('/repair/update', apiWrapper(async ({ db, body, user }) => {
    return dataProcessor.updateRepairTicket({ 
        db, 
        ticketId: body.ticketId,
        action: body.action,
        data: body.data,
        userEmail: user.email,
        userName: user.name || user.email,
        userRoles: user.roles
    });
}));

// --- ROUTER 3: INVENTORY (VẬT TƯ) ---
const inventoryRouter = express.Router();
inventoryRouter.use(authenticate); // Yêu cầu xác thực cho tất cả các route vật tư

inventoryRouter.post('/uploadBatch', canApproveBorrowsOrAdmin, apiWrapper(async ({ db, body }) => {
    return dataProcessor.uploadInventoryBatch({ db, items: body.items });
}));

inventoryRouter.post('/list', canApproveBorrowsOrAdmin, apiWrapper(async ({ db }) => {
    return dataProcessor.getInventoryFromFirestore({ db });
}));


// === KẾT THÚC THÊM MỚI ===

// --- ROUTER 3: AUDIT (KIỂM KHO) ---
const auditRouter = express.Router();
auditRouter.use(authenticate); // Yêu cầu xác thực

// Endpoint để cập nhật số lượng một vật tư trong phiên kiểm kho
auditRouter.post('/updateItem', isAuditorOrAdmin, apiWrapper(async ({ db, body, user }) => {
    return dataProcessor.updateAuditItem({ 
        db, 
        auditId: body.auditId,
        itemCode: body.itemCode,
        quantity: body.quantity,
        user: user 
    });
}));

// Endpoint để kết thúc phiên kiểm kho
auditRouter.post('/finishSession', isAuditorOrAdmin, apiWrapper(async ({ db, body, user }) => {
    return dataProcessor.finishAuditSession({ 
        db, 
        auditId: body.auditId,
        user: user 
    });
}));

// Endpoint để xóa toàn bộ kết quả kiểm kê của một phiên
auditRouter.post('/resetSession', isAuditorOrAdmin, apiWrapper(async ({ db, body, user }) => {
    return dataProcessor.resetAuditSession({
        db,
        auditId: body.auditId,
        user: user
    });
}));

// Gắn router kiểm kho vào app
app.use('/api/audit', auditRouter);

app.use('/api', privateRouter);
app.use('/api/inventory', inventoryRouter); // Gắn router vật tư


// 5. EXPORT HÀM GCF
exports.app = functions.https.onRequest(app);