// functions/index.js (FINAL - Cấu trúc Router Chính xác)

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const express = require('express');
const cors = require('cors');

// Import logic nghiệp vụ
const dataProcessor = require('./data-processor');

// Khai báo ID Sheets
const SPREADSHEET_ID = '1vzhV7X-mBEG8tIqYg-JTTCMkbEYX9RDJbYczZIaOTK0'; 

// 1. KHỞI TẠO FIREBASE ADMIN SDK
admin.initializeApp();
const db = admin.firestore(); // Firestore Client

// 2. KHỞI TẠO GOOGLE SHEETS API CLIENT
const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/cloud-platform']
});
const sheets = google.sheets({ version: 'v4', auth }); // Khởi tạo Sheets Client


// 3. THIẾT LẬP EXPRESS APP VÀ MIDDLEWARE
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());


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

        // 1. Lấy vai trò Quản lý
        const isMng = await dataProcessor.checkManager({ sheets, spreadsheetId: SPREADSHEET_ID, email: userEmail });
        
        req.user = { 
            email: userEmail, 
            isManager: isMng, 
        };
        
        return next();

    } catch (e) {
        console.error('Token Verification Failed:', e.stack);
        return res.status(401).send({ error: 'Invalid authentication token: ' + e.message });
    }
};


// =======================================================
// 4. ĐỊNH TUYẾN API ENDPOINTS
// =======================================================
const apiWrapper = (handler) => async (req, res) => {
    try {
        const result = await handler({
            sheets, 
            spreadsheetId: SPREADSHEET_ID, 
            db,      
            user: req.user, 
            body: req.body,
            query: req.query,
        });

        res.status(200).send({ ok: true, data: result });
    } catch (error) {
        console.error('API Handler Error:', error.message, error.stack);
        res.status(500).send({ ok: false, error: error.message || 'Lỗi server không xác định.' });
    }
};


// --- ROUTER 1: PUBLIC AUTH ROUTES ---
const authRouter = express.Router();

// 4n. Xác thực và Đăng ký KTV mới (PHẢI CÔNG KHAI)
authRouter.post('/verifyAndRegister', apiWrapper(async ({ sheets, spreadsheetId, body }) => { 
    return dataProcessor.verifyAndRegisterUser({ 
        sheets, 
        spreadsheetId, 
        email: body.email, 
        name: body.name 
    });
}));

// GẮN ROUTER AUTH CÔNG KHAI VÀO APP.USE
app.use('/api/auth', authRouter); 


// --- ROUTER 2: PRIVATE (CẦN AUTHENTICATE) ---
const privateRouter = express.Router();
privateRouter.use(authenticate); // Áp dụng Auth cho TẤT CẢ TUYẾN ĐƯỜNG PRIVATE SAU ĐÂY


// 4a. Dashboard Data (Tổng quan và Pending Notes)
privateRouter.post('/dashboard', apiWrapper(async ({ sheets, spreadsheetId, db, user, body }) => {
    const technicianEmail = body.technicianEmail || user.email;

    return dataProcessor.getTechnicianDashboardData({
        sheets, 
        spreadsheetId, 
        db, 
        email: technicianEmail,
        isManager: user.isManager 
    });
}));

// 4b. Lịch sử Mượn
privateRouter.post('/history/byemail', apiWrapper(async ({ sheets, spreadsheetId, db, body, user }) => { // ADD 'db' here
    return dataProcessor.getBorrowHistory({
        sheets,
        spreadsheetId,
        db, // <-- ADD THIS LINE to pass db
        email: body.email || user.email,
        dateStr: body.date,
        isLast5Days: body.isLast5Days,
        currentPage: body.currentPage,
        pageSize: body.pageSize,
    });
}));
// Lịch sử Trả (Không sử dụng)
privateRouter.post('/history/return', apiWrapper(async ({ sheets, spreadsheetId, db, body, user }) => { // Thêm 'db'
    return dataProcessor.getReturnHistory({
        sheets, 
        spreadsheetId, 
        db, // <-- THÊM DÒNG NÀY
        email: body.email || user.email, 
        currentPage: body.currentPage, 
        pageSize: body.pageSize,
    });
}));
// 4c. Submit Lệnh Mượn (KTV)
privateRouter.post('/submit/borrow', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4d. Submit Lệnh Trả (KTV)
privateRouter.post('/submit/return', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4e. Submit Báo cáo Sai sót (KTV)
privateRouter.post('/submit/errorReport', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.submitErrorReport({ sheets, spreadsheetId, data: body });
}));

// 4f. Danh sách Kỹ thuật viên (Cho dropdown Quản lý)
privateRouter.post('/manager/technicians', apiWrapper(async ({ sheets, spreadsheetId }) => {
    return dataProcessor.getTechnicians({ sheets, spreadsheetId });
}));

// 4g. Danh mục vật tư (Cho Autocomplete)
privateRouter.post('/manager/items', apiWrapper(async ({ sheets, spreadsheetId }) => {
    return dataProcessor.getItemList({ sheets, spreadsheetId });
}));

// 4h. Gửi Vật tư Mượn/Trả (Quản lý)
privateRouter.post('/manager/submitBorrow', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4i. Xác nhận Đối chiếu (Quản lý)
privateRouter.post('/manager/submitReturn', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
    return dataProcessor.submitTransaction({ sheets, spreadsheetId, db, data: body });
}));

// 4j. Tải Dải Số Sổ
privateRouter.post('/manager/ticketRanges', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.getTicketRanges({ sheets, spreadsheetId, email: body.email });
}));

// 4k. Lưu Dải Số Sổ
privateRouter.post('/manager/saveTicketRanges', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.saveTicketRanges({ sheets, spreadsheetId, email: body.email, ranges: body.ranges });
}));

// 4l. Xử lý Upload Excel (Chuẩn hóa)
privateRouter.post('/manager/processExcelData', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.processExcelData({ sheets, spreadsheetId, data: body.data });
}));

// 4m. Lưu Dữ liệu Excel đã Xử lý
privateRouter.post('/manager/saveExcelData', apiWrapper(async ({ sheets, spreadsheetId, body }) => {
    return dataProcessor.saveExcelData({ sheets, spreadsheetId, data: body.data });
}));

// 4n. Từ chối Note Trả hàng (Quản lý)
privateRouter.post('/manager/rejectReturnNote', apiWrapper(async ({ db, body }) => {
    return dataProcessor.rejectReturnNote({ db, data: body });
}));

// 4o. Chuyển vật tư (Quản lý)
privateRouter.post('/manager/transferItems', apiWrapper(async ({ sheets, spreadsheetId, db, body }) => {
   // ... old code ...
}));

// PASTE NEW ROUTE HERE
// 4p. Từ chối Note Mượn hàng (Quản lý)
privateRouter.post('/manager/rejectBorrowNote', apiWrapper(async ({ db, body }) => {
    return dataProcessor.rejectBorrowNote({ db, data: body });
}));

// 4q. Lấy số lượng yêu cầu đang chờ (Quản lý)
privateRouter.post('/manager/pendingCounts', apiWrapper(async ({ db }) => {
    return dataProcessor.getPendingCounts({ db });
}));

// GẮN ROUTER PRIVATE
app.use('/api', privateRouter); 


// 5. EXPORT HÀM GCF
exports.app = functions.https.onRequest(app);