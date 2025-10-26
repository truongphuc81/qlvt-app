// functions/data-processor.js (FIXED - Logic Firestore)

const utils = require('./utils');
const { google } = require('googleapis');
const admin = require('firebase-admin'); 

// Hằng số cho Collection IDs
const PENDING_NOTES_COLLECTION = 'pending_notes';
const USAGE_TICKETS_COLLECTION = 'usage_tickets';
const PENDING_RETURN_NOTES_COLLECTION = 'pending_return_notes';

// FIX: Hàm tiện ích để lấy Firestore Client (sẽ chỉ chạy sau khi index.js gọi initializeApp)
// const getDb = () => {
//     try {
//         return admin.firestore();
//     } catch (e) {
//         // Lỗi này KHÔNG nên xảy ra nếu index.js được cấu hình đúng.
//         console.error("Firestore initialization error: Make sure admin.initializeApp() is called.");
//         throw e;
//     }
// };
// =======================================================
// HELPER TRUY CẬP SHEETS
// =======================================================

// Hàm này được sử dụng để đọc tất cả các Sheets cần thiết chỉ trong một lần gọi API
// Hàm này được sử dụng để đọc tất cả các Sheets cần thiết chỉ trong một lần gọi API
// functions/data-processor.js (FIXED - Trả về các biến đã tính toán)

// functions/data-processor.js (FIXED - Đảm bảo sheets client tồn tại)

// ... (logic của các hàm khác) ...

// =======================================================
// HELPER TRUY CẬP SHEETS
// =======================================================

// Hàm này được sử dụng để đọc tất cả các Sheets cần thiết chỉ trong một lần gọi API
// File: functions/data-processor.js

/**
 * Đọc dữ liệu thô cần thiết từ các Sheet
 */
async function readAllSheetsData({ sheets, spreadsheetId, email }) {
    // Luôn cần Item Code Map
    const itemCodeMap = new Map();
    // Luôn cần Ticket Ranges Map
    const ticketRangesMap = [];

    // Khởi tạo các mảng dữ liệu mặc định là rỗng
    let history = [];
    let comparisonData = [];
    let pendingNotes = []; // Khởi tạo pendingNotes ở đây

    try { // Bắt đầu khối try lớn bao quanh toàn bộ hàm

        // 1. Đọc Danh sách Vật tư -> Map Code -> Tên
        try {
            const itemsResult = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'Danh sách vật tư!A2:B', // Chỉ đọc Mã (A) và Tên (B)
            });
            (itemsResult.data.values || []).forEach(row => {
                if (row[0]) itemCodeMap.set(utils.normalizeCode(row[0]), row[1] || row[0]);
            });
            console.log(`[DEBUG readAllSheetsData] Loaded ${itemCodeMap.size} items.`);
        } catch (err) {
            console.error("!!! ERROR reading Item List sheet:", err.message);
            // Có thể tiếp tục mà không có item map, tên sẽ là mã code
        }

        // 2. Đọc Lịch sử Mượn/Trả (nếu cần email hoặc đang xử lý dashboard)
        if (email) { // Chỉ đọc lịch sử nếu có email cụ thể được cung cấp
           try {
                const historyResult = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: 'Lịch sử Mượn Trả Vật Tư!A2:J', // Đọc 10 cột A-J
                });
                history = (historyResult.data.values || []).filter(row => row.length > 2 && utils.normalizeCode(row[2]) === utils.normalizeCode(email)); // Lọc theo email
                console.log(`[DEBUG readAllSheetsData] Read ${history.length} history rows for ${email}.`);
            } catch (err) {
                console.error(`!!! ERROR reading History sheet for ${email}:`, err.message);
                history = []; // Trả về mảng rỗng nếu lỗi
            }
        }


        // 3. Đọc dữ liệu Đối chiếu sổ 3 liên (nếu cần email hoặc đang xử lý dashboard)
        if (email) { // Chỉ đọc đối chiếu nếu có email
            try {
                const comparisonResult = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: 'Đối chiếu sổ 3 liên!A2:H', // Đọc các cột A-H
                });
                comparisonData = (comparisonResult.data.values || []).filter(row => row.length > 5 && utils.normalizeCode(row[5]) === utils.normalizeCode(email)); // Lọc theo email (Cột F)
                console.log(`[DEBUG readAllSheetsData] Read ${comparisonData.length} rows from Comparison sheet for ${email}.`);
            } catch (err) {
                console.error(`!!! ERROR reading Comparison sheet for ${email}:`, err.message);
                comparisonData = []; // Đảm bảo trả về mảng rỗng nếu lỗi
            }
        }


        // 4. Đọc Dải số sổ (Luôn cần khi xử lý Excel hoặc dashboard)
         try {
             const rangesResult = await sheets.spreadsheets.values.get({
                 spreadsheetId,
                 range: 'TicketRanges!A2:C', // Đọc Email(A), Start(B), End(C)
             });
             (rangesResult.data.values || []).forEach(row => {
                 const emailR = row[0] || '';
                 const start = Number(row[1]) || 0;
                 const end = Number(row[2]) || 0;
                 if (emailR && start > 0 && end >= start) {
                     ticketRangesMap.push({ email: emailR, start, end });
                 }
             });
             console.log(`[DEBUG readAllSheetsData] Loaded ${ticketRangesMap.length} ticket ranges.`);
         } catch (err) {
             console.error("!!! ERROR reading TicketRanges sheet:", err.message);
             // Có thể tiếp tục nhưng việc tìm email qua số sổ sẽ thất bại
         }


        // 5. Đọc Pending Notes từ Firestore (nếu cần email)
        // Lưu ý: Phần này bị comment trong code bạn gửi, giữ nguyên trạng thái comment
        /*
        if (email) {
            try {
                const db = getDb();
                console.log(`[DEBUG] Querying Firestore for email: ${email}`); // Log trước khi query
                const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
                    .where('email', '==', utils.normalizeCode(email))
                    .where('isFulfilled', '==', false)
                    .orderBy('createdAt','desc') // FIX: Buộc sử dụng trường createdAt (đã xác nhận tồn tại)
                    .get();

                pendingNotes = pendingSnapshot.docs.map(doc => doc.data());
                console.log(`[DEBUG] Found ${pendingNotes.length} pending notes for ${email} in Firestore.`); // Log sau khi query
            } catch (firestoreError) {
                console.error("!!! FIRESTORE ERROR reading pending notes:", firestoreError);
                pendingNotes = []; // Trả về mảng rỗng nếu lỗi Firestore
            }
        }
        */

        // Trả về tất cả dữ liệu đã đọc (hoặc mảng rỗng nếu có lỗi)
        return {
            itemCodeMap,
            history,
            comparisonData, // Luôn là một mảng
            ticketRangesMap,
            pendingNotes // Sẽ là [] nếu không đọc Firestore
        };

    } catch (error) { // Khối catch lớn bao quanh toàn bộ hàm
        console.error('Error in readAllSheetsData:', error);
        // THÊM DÒNG RETURN NÀY để đảm bảo hàm luôn trả về cấu trúc đúng
        return { itemCodeMap: new Map(), history: [], comparisonData: [], ticketRangesMap: [], pendingNotes: [] };
    }
} // Đóng hàm readAllSheetsData
// =======================================================
// 5. CHECK MANAGER ROLE
// =======================================================
async function checkManager({ sheets, spreadsheetId, email }) {
    const normEmail = utils.normalizeCode(email);
    
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Danh sách quản lý!A:A', // Đọc cột email quản lý
    });

    const managerList = response.data.values || [];
    
    // Tìm email trong danh sách quản lý
    const isManager = managerList.some(row => utils.normalizeCode(row[0]) === normEmail);
    
    return isManager;
}
// =======================================================
// HÀM QUẢN LÝ (getTechnicians, getItemList)
// =======================================================
async function getTechnicians({ sheets, spreadsheetId }) {
    const sheetName = 'Danh sách kỹ thuật viên';
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:B`,
    });
    
    return (result.data.values || [])
        .filter(row => row[0])
        .map(row => ({
            email: row[0].toString().trim(),
            name: row[1] ? row[1].toString().trim() : ''
        }));
}

async function getItemList({ sheets, spreadsheetId }) {
    const sheetName = 'Danh sách vật tư';
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:B`,
    });
    
    return (result.data.values || [])
        .filter(row => row[0])
        .map(row => ({
            code: utils.normalizeCode(row[0]),
            name: row[1] ? row[1].toString().trim() : ''
        }));
}

// =======================================================
// 4. QUẢN LÝ DẢI SỔ (Ticket Ranges)
// =======================================================

// Lấy dải số sổ cho KTV cụ thể
async function getTicketRanges({ sheets, spreadsheetId, email }) {
    const { ticketRangesMap } = await readAllSheetsData({ sheets, spreadsheetId, email });
    const normEmail = utils.normalizeCode(email);
    
    // Tái tạo logic lọc và gộp dải số như Apps Script cũ
    const filteredRanges = ticketRangesMap
        .filter(r => r.email === normEmail)
        .map(r => ({ start: r.start, end: r.end }))
        .sort((a, b) => a.start - b.start);
        
    // Logic gộp dải số (Merging Logic - Tái tạo từ Apps Script)
    const merged = [];
    for (const range of filteredRanges) {
        if (!merged.length || range.start > merged[merged.length - 1].end + 1) {
            merged.push({ start: range.start, end: range.end });
        } else {
            merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
        }
    }
    return merged;
}

// Lưu/Cập nhật dải số sổ
async function saveTicketRanges({ sheets, spreadsheetId, email, ranges }) {
    // NOTE: Trong môi trường Node.js, đây là logic phức tạp nhất
    // vì Sheets API không có hàm xóa dòng theo điều kiện đơn giản.
    
    // GIẢ ĐỊNH: Ta sẽ đọc, tìm vị trí dòng, và sử dụng Sheets.BatchUpdate để xóa dòng, sau đó Append.

    // Bước 1: (CẦN CODE THỰC THI) Xóa toàn bộ dải số cũ của KTV này
    // ... (Thực hiện Sheets.BatchUpdate deleteDimension request) ...
    
    // Bước 2: Ghi các dải số mới
    if (ranges && ranges.length > 0) {
        const rows = ranges.map(r => [email, r.start, r.end, new Date().toISOString(), new Date().toISOString()]);
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'TicketRanges!A:E', 
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows },
        });
    }
    return true;
}


// =======================================================
// 1. DASHBOARD DATA (getTechnicianDashboardData)
// =======================================================
async function getTechnicianDashboardData({ sheets, spreadsheetId, db, email, isManager }) {
    console.log('!!! RUNNING LATEST getTechnicianDashboardData CODE !!!');
    const normEmail = utils.normalizeCode(email).toLowerCase();
    
    // START DEBUG LOG: Ghi lại email đang được sử dụng để truy vấn
    console.log(`[DEBUG] Querying Firestore for email: ${normEmail}`);
    
    // Đọc tất cả các Sheets cần thiết (KHÔNG BAO GỒM PendingBorrowNotes SHEET)
    const { itemCodeMap, history, comparisonData, ticketRangesMap } = await readAllSheetsData({ sheets, spreadsheetId, email: normEmail });
    
    // A. Xử lý logic Mượn/Trả cơ bản (Tái tạo getBorrowedItems)
    const byCode = {};
    const totalReconciledUsed = {}; 
    
    // Lọc và tính toán từ History
    history.forEach(row => {
        const rowEmail = utils.normalizeCode(row[2]);
        if (normEmail && rowEmail !== normEmail) return;

        const type = (row[1] || '').toString().trim();
        const code = utils.normalizeCode(row[4] || '');
        const qty = Number(row[6]) || 0;
        
        if (!code) return;

        if (!byCode[code]) {
            byCode[code] = { code, name: itemCodeMap.get(code) || '', quantity: 0, totalUsed: 0, totalReturned: 0, unreconciledUsageDetails: [], reconciledUsageDetails: [] };
        }
        
        if (type === 'Mượn') {
            byCode[code].quantity += qty;
        } else if (type === 'Trả') {
            byCode[code].totalReturned += qty;
        }
    });

    // B. Xử lý dữ liệu Đối chiếu (comparisonData)
    comparisonData.forEach(row => {
        const itemCode = utils.normalizeCode(row[1] || ''); // Mã VT
        const ticket = row[3] || ''; // Số sổ
        const quantityUsed = Number(row[4]) || 0; // SL sử dụng
        const status = row[7] || 'Chưa đối chiếu'; // Trạng thái
        const note = row[6] || ''; // Ghi chú

        if (!itemCode || quantityUsed <= 0 || !ticket) return;

        // Đảm bảo có mục này trong byCode (tạo nếu chưa có)
        if (!byCode[itemCode]) {
            // Nếu vật tư này không có trong lịch sử Mượn/Trả, tạm thời tạo với quantity=0
             byCode[itemCode] = { name: itemCodeMap.get(itemCode) || row[2], quantity: 0, totalUsed: 0, unreconciledUsageDetails: [], reconciledUsageDetails: [] };
             console.log(`[DEBUG Dashboard ${normEmail}] Initialized byCode for ${itemCode} from comparison data.`); // Log thêm
        }

        // Phân loại vào unreconciled hoặc reconciled
        const detail = { ticket, quantity: quantityUsed, note };
        if (status === 'Chưa đối chiếu') {
            byCode[itemCode].unreconciledUsageDetails.push(detail);
            byCode[itemCode].totalUsed += quantityUsed; // Cộng vào tổng sử dụng
        } else if (status === 'Đã đối chiếu') {
            byCode[itemCode].reconciledUsageDetails.push(detail);
            // ĐÃ ĐỐI CHIẾU VẪN PHẢI CỘNG VÀO totalUsed ĐỂ KHẤU TRỪ ĐÚNG
            byCode[itemCode].totalUsed += quantityUsed;
        }
    });

    // <<< LOG 2: Dữ liệu sau khi tổng hợp sử dụng >>>
    console.log(`[DEBUG Dashboard ${normEmail}] Aggregated byCode Data (after comparison):`, JSON.stringify(byCode, null, 2));

    // C. Kết hợp và tính toán
    const items = Object.keys(byCode).map(code => {
        const data = byCode[code];
        const borrowed = Number(data.quantity) || 0;
        const returned = Number(data.totalReturned) || 0;
        const used     = Number(data.totalUsed) || 0;
        const remaining = (borrowed - returned) - used;
    return {
            code,
            name: data.name,
            quantity: borrowed,
            totalReturned: returned,
            totalUsed: used,
            remaining,
            unreconciledUsageDetails: data.unreconciledUsageDetails,
            reconciledUsageDetails: data.reconciledUsageDetails,
        };
    }).filter(a =>
        a.quantity > 0 ||                 // 1. Vẫn còn nợ
        (a.unreconciledUsageDetails && a.unreconciledUsageDetails.length > 0) || // 2. Vẫn còn sổ CHƯA đối chiếu (Sửa lại logic filter)
        (a.reconciledUsageDetails && a.reconciledUsageDetails.length > 0) // 3. HOẶC có lịch sử ĐÃ đối chiếu
    );

    // <<< LOG 3: Dữ liệu cuối cùng trả về client >>>
    console.log(`[DEBUG Dashboard ${normEmail}] Final items data:`, JSON.stringify(items, null, 2));

    /// D. Xử lý Pending Notes (Truy vấn FIRESTORE)
    let pendingNotes = []; // Khởi tạo mảng rỗng ở đây
    try { // Thêm try...catch cho Firestore query
        console.log(`[DEBUG Dashboard ${normEmail}] Querying Firestore PENDING_NOTES...`); // Log trước query

        // D.1. Lấy Pending Borrow Notes
        const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            // .orderBy('createdAt', 'desc') // Giữ comment nếu index chưa hoạt động
            .get();

        // Log kết quả snapshot
        console.log(`[DEBUG Dashboard ${normEmail}] Firestore PENDING_NOTES snapshot size: ${pendingSnapshot.size}`);

        // Kiểm tra snapshot.docs trước khi map
        if (pendingSnapshot && pendingSnapshot.docs) {
            const pendingNotesRaw = pendingSnapshot.docs.map(doc => {
                return doc.data();
            });

            // Log dữ liệu raw
            console.log(`[DEBUG Dashboard ${normEmail}] Firestore PENDING_NOTES Raw Data:`, JSON.stringify(pendingNotesRaw, null, 2));

            // Đảm bảo pendingNotesRaw là mảng trước khi forEach
            if (Array.isArray(pendingNotesRaw)) {
                // Xử lý dữ liệu raw thành định dạng cần thiết
                pendingNotes = pendingNotesRaw.map(data => { // Dùng map thay vì forEach để tạo mảng mới
                    return {
                        timestamp: data.timestamp, // Giữ nguyên để khớp với client
                        note: data.note,
                        date: data.date,
                        // Không cần thêm status/reason ở đây vì client không dùng
                    };
                });
                 console.log(`[DEBUG Dashboard ${normEmail}] Processed pendingNotes:`, JSON.stringify(pendingNotes, null, 2));
            } else {
                console.error(`[!!ERROR!! Dashboard ${normEmail}] pendingNotesRaw is not an array!`, pendingNotesRaw);
                pendingNotes = []; // Reset thành mảng rỗng nếu có lỗi
            }
        } else {
             console.warn(`[WARN Dashboard ${normEmail}] Firestore PENDING_NOTES snapshot.docs is invalid.`);
             pendingNotes = []; // Reset thành mảng rỗng
        }

    } catch (firestoreError) {
         console.error(`[!!ERROR!! Dashboard ${normEmail}] Error querying Firestore PENDING_NOTES:`, firestoreError);
         pendingNotes = []; // Reset thành mảng rỗng nếu có lỗi
    }


    // D.2. LẤY PENDING RETURN NOTES (Tương tự, đảm bảo có try...catch và kiểm tra)
    let pendingReturnNotes = [];
    try {
        console.log(`[DEBUG Dashboard ${normEmail}] Querying Firestore PENDING_RETURN_NOTES...`);

        const pendingReturnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected']) // Giữ lại not-in
            .get();

         console.log(`[DEBUG Dashboard ${normEmail}] Firestore PENDING_RETURN_NOTES snapshot size: ${pendingReturnSnapshot.size}`);

         if (pendingReturnSnapshot && pendingReturnSnapshot.docs) {
            const pendingReturnNotesRaw = pendingReturnSnapshot.docs.map(doc => {
                return doc.data();
            });

            console.log(`[DEBUG Dashboard ${normEmail}] Firestore PENDING_RETURN_NOTES Raw Data:`, JSON.stringify(pendingReturnNotesRaw, null, 2));

            if (Array.isArray(pendingReturnNotesRaw)) {
                pendingReturnNotes = pendingReturnNotesRaw.map(data => {
                    return {
                        timestamp: data.timestamp,
                        note: data.note,
                        date: data.date,
                    };
                });
                 console.log(`[DEBUG Dashboard ${normEmail}] Processed pendingReturnNotes:`, JSON.stringify(pendingReturnNotes, null, 2));
            } else {
                 console.error(`[!!ERROR!! Dashboard ${normEmail}] pendingReturnNotesRaw is not an array!`, pendingReturnNotesRaw);
                 pendingReturnNotes = [];
            }
         } else {
              console.warn(`[WARN Dashboard ${normEmail}] Firestore PENDING_RETURN_NOTES snapshot.docs is invalid.`);
              pendingReturnNotes = [];
         }

    } catch (firestoreError) {
         console.error(`[!!ERROR!! Dashboard ${normEmail}] Error querying Firestore PENDING_RETURN_NOTES:`, firestoreError);
         pendingReturnNotes = [];
    }

    // Trả về kết quả cuối cùng
    return {
        items: items,
        pendingNotes: pendingNotes, // Luôn là một mảng
        pendingReturnNotes: pendingReturnNotes, // Luôn là một mảng
    };
}


// =======================================================
// 2. LỊCH SỬ (getBorrowHistory)
// =======================================================
// File: data-processor.js (REPLACE this function)

// File: data-processor.js (THAY THẾ HÀM NÀY)

async function getBorrowHistory({ sheets, spreadsheetId, db, email, dateStr = null, isLast5Days = false, currentPage, pageSize }) {
    const { itemCodeMap, history } = await readAllSheetsData({ sheets, spreadsheetId, email });
    const normEmail = utils.normalizeCode(email);

    // 1. Lấy trạng thái từ Firestore (Logic được làm rõ hơn)
    const statusMap = new Map();
    const snapshot = await db.collection(PENDING_NOTES_COLLECTION) // Đọc collection note MƯỢN
        .where('email', '==', normEmail)
        .get();

    snapshot.forEach(doc => {
        const data = doc.data();
        const timestamp = data.timestamp; // Key là timestamp của note
        if (!timestamp) return; // Bỏ qua nếu không có timestamp

        if (data.status === 'Rejected') {
            statusMap.set(timestamp, { status: 'Rejected', reason: data.rejectionReason || 'Không rõ' });
        } else if (data.isFulfilled === false) { // Nếu chưa fulfilled và không phải Rejected -> là Pending
            statusMap.set(timestamp, { status: 'Pending' });
        } else { // isFulfilled === true
             // Nếu đã fulfilled mà không có trạng thái đặc biệt, coi là Fulfilled
             // Chỉ gán nếu chưa có trạng thái khác (Pending/Rejected) được gán trước đó
             if (!statusMap.has(timestamp)) {
                statusMap.set(timestamp, { status: 'Fulfilled' });
             }
        }
    });

    // --- Phần xử lý dữ liệu từ Google Sheet ---
    const now = new Date();
    const fiveDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
    const buckets = {}; // Dùng để gom nhóm các dòng lịch sử liên quan đến cùng một note/giao dịch
    const reversedHistory = history.reverse(); // Đảo ngược để xử lý từ mới đến cũ

    reversedHistory.forEach(row => {
        const ts = row[0]; // Timestamp từ Sheet
        const type = row[1] || '';
        const eml = utils.normalizeCode(row[2]);
        const ngay = row[3] || '';
        const code = utils.normalizeCode(row[4] || '');
        const qty = Number(row[6]) || 0;
        const note = row[7] || '';
        const pendingNoteId = row[9] || ''; // ID liên kết đến note trong Firestore (quan trọng)

        // Chỉ lấy giao dịch 'Mượn' của đúng KTV
        if (type !== 'Mượn') return;
        if (normEmail && eml !== normEmail) return;

        const tsDate = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(tsDate.getTime())) return;

        // Lọc theo ngày (nếu có)
        if (dateStr && ngay !== dateStr) return;
        if (isLast5Days) {
            const rowDay = new Date(tsDate.getFullYear(), tsDate.getMonth(), tsDate.getDate());
            if (rowDay < fiveDaysAgo) return;
        }

        // Key để gom nhóm: Ưu tiên ID note, nếu không có thì dùng timestamp của giao dịch
        const key = pendingNoteId || tsDate.toISOString();

        // Lấy trạng thái từ Map DỰA VÀO pendingNoteId (nếu có)
        // Chỉ những dòng có pendingNoteId mới có thể có trạng thái Pending/Rejected
        const statusInfo = pendingNoteId ? statusMap.get(pendingNoteId) : null;

        // Nếu chưa có bucket cho key này, tạo mới
        if (!buckets[key]) {
             buckets[key] = {
                 timestamp: tsDate.toISOString(), // Giữ timestamp gốc của giao dịch
                 date: ngay,
                 note: note, // Ghi chú từ dòng đầu tiên tìm thấy
                 itemsEntered: {}, // Danh sách vật tư
                 // Gán status nếu tìm thấy thông tin từ Firestore.
                 // Nếu không có ID note (giao dịch trực tiếp), mặc định là Fulfilled.
                 // Nếu có ID note mà không tìm thấy statusInfo (lỗi?), tạm để là null.
                 status: statusInfo ? statusInfo.status : (pendingNoteId ? null : 'Fulfilled'),
                 reason: statusInfo ? statusInfo.reason : null
             };
        } else {
             // Nếu bucket đã tồn tại, cập nhật nếu cần
             // Ưu tiên giữ lại note dài nhất (thường là note gốc KTV gửi)
             if (note && (!buckets[key].note || note.length > buckets[key].note.length)) {
                buckets[key].note = note;
             }
             // Cập nhật trạng thái nếu trước đó chưa tìm thấy
             if (statusInfo && !buckets[key].status) {
                 buckets[key].status = statusInfo.status;
                 buckets[key].reason = statusInfo.reason;
             }
        }

        // Thêm vật tư vào bucket (chỉ khi có mã và số lượng)
        if (code && qty > 0) {
            const m = buckets[key].itemsEntered;
            if (!m[code]) m[code] = { code: code, name: itemCodeMap.get(code) || row[5], quantity: 0 };
            m[code].quantity += qty;
        }
    });

    // Chuyển buckets thành mảng và lọc
    const arr = Object.keys(buckets).map(k => buckets[k]);
    // Giữ lại: Pending/Rejected HOẶC (Fulfilled VÀ có vật tư hoặc có note gốc)
    const finalArr = arr.filter(b => (b.status !== 'Fulfilled') || (b.status === 'Fulfilled' && (Object.keys(b.itemsEntered).length > 0 || b.note)));

    // Sắp xếp lại theo thời gian giảm dần (mới nhất lên trước)
    finalArr.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Xử lý phân trang
    const totalItems = finalArr.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (currentPage - 1) * pageSize;
    const historyPage = finalArr.slice(start, start + pageSize);

    return { history: historyPage, totalPages: totalPages };
}


async function getReturnHistory({ sheets, spreadsheetId, db, email, currentPage, pageSize }) {
    const { itemCodeMap, history } = await readAllSheetsData({ sheets, spreadsheetId, email });
    const normEmail = utils.normalizeCode(email);
    
    // 1. Lấy trạng thái từ Firestore (MỚI)
    const statusMap = new Map();
    // Đọc collection note trả hàng
    const snapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .get();
        
    snapshot.forEach(doc => {
        const data = doc.data();
        // Gán trạng thái dựa trên dữ liệu Firestore
        if (data.status === 'Rejected') {
            statusMap.set(data.timestamp, { status: 'Rejected', reason: data.rejectionReason || 'Không rõ' });
        } else if (data.isFulfilled === false) {
            statusMap.set(data.timestamp, { status: 'Pending' });
        } else {
            statusMap.set(data.timestamp, { status: 'Fulfilled' });
        }
    });

    const buckets = {};
    const reversedHistory = history.reverse();
    
    reversedHistory.forEach(row => {
        const ts = row[0];
        const type = row[1] || '';
        const eml = utils.normalizeCode(row[2]);
        const ngay = row[3] || '';
        const code = utils.normalizeCode(row[4] || '');
        const qty = Number(row[6]) || 0;
        const note = row[7] || '';
        const pendingNoteId = row[9] || ''; // ID của note trả hàng

        if (type !== 'Trả') return; 
        if (normEmail && eml !== normEmail) return;

        // BỎ LỌC: không bỏ qua note rỗng
        // if (!code || qty <= 0) return; // <-- ĐÃ XÓA DÒNG NÀY

        const tsDate = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(tsDate.getTime())) return;

        const key = pendingNoteId || tsDate.toISOString();
        
        // Lấy trạng thái từ Map
        const statusInfo = statusMap.get(pendingNoteId);

        if (!buckets[key]) {
            buckets[key] = { 
                timestamp: tsDate.toISOString(), 
                date: ngay, 
                note: note, 
                itemsEntered: {},
                status: statusInfo ? statusInfo.status : null, // Thêm status
                reason: statusInfo ? statusInfo.reason : null  // Thêm lý do
            }; 
        }

        // Chỉ thêm vật tư nếu có (dành cho note đã duyệt)
        if (code && qty > 0) {
            const m = buckets[key].itemsEntered;
            if (!m[code]) m[code] = { code: code, name: itemCodeMap.get(code) || row[5], quantity: 0 };
            m[code].quantity += qty;
        }
    });

    const arr = Object.keys(buckets).map(k => buckets[k]);
    // Lọc ra: chỉ giữ lại (Pending/Rejected) HOẶC (Fulfilled VÀ có vật tư)
    const finalArr = arr.filter(b => (b.status !== 'Fulfilled') || (b.status === 'Fulfilled' && Object.keys(b.itemsEntered).length > 0));

    // Xử lý phân trang
    const totalItems = finalArr.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (currentPage - 1) * pageSize;
    const historyPage = finalArr.slice(start, start + pageSize);
    
    return { history: historyPage, totalPages: totalPages };
}

// =======================================================
// 3. SUBMIT TRANSACTION (submitTransaction)
// =======================================================
async function submitTransaction({ sheets, spreadsheetId, db, data }) {
    // const db = getDb(); // Lấy db an toàn
    const COL_COUNT_HIST = 10;
    const rows = [];
    const lowerEmail = utils.normalizeCode(data.email);

    // --- LOGIC MƯỢN (KTV & MANAGER) ---
    if (data.type === 'Mượn') {
        const ts = data.timestamp ? new Date(data.timestamp) : new Date();
        const pendingNoteId = data.borrowTimestamp || ''; 
        const selfNoteId = ts.toISOString(); 
        const items = data.items || [];
        const note = data.note || '';
        const srcTag = (data.mode === 'DIRECT') ? 'DIRECT' : (data.borrowTimestamp ? 'NOTE' : 'WEBAPP');
        
        const shouldCreatePendingNote = !data.borrowTimestamp && data.mode !== 'DIRECT' && note && items.length === 0;

        // 1. Ghi items vào Lịch sử (Sheets API)
        items.forEach(it => {
            rows.push([ ts, 'Mượn', data.email, data.date, utils.normalizeCode(it.code), it.name, Number(it.quantity) || 0, note, srcTag, pendingNoteId ]); 
        });
        
        // 2. Ghi Note-only vào Lịch sử (Sheets API)
        if (items.length === 0 && note) {
            rows.push([ ts, 'Mượn', data.email, data.date, '', '', 0, note, srcTag, selfNoteId ]);
        }
        
        // 3. LƯU VÀO PendingBorrowNotes (FIRESTORE)
        if (shouldCreatePendingNote) {
            await db.collection(PENDING_NOTES_COLLECTION).add({ // SỬ DỤNG DB AN TOÀN
                timestamp: selfNoteId,
                type: 'Mượn', 
                email: data.email, 
                date: data.date, 
                note: note, 
                isFulfilled: false,
                status: 'Pending',
                createdAt: new Date().toISOString()
            });
        }

        // 4. Nếu quản lý mượn theo lệnh chờ => Fulfilled pending
        if (data.borrowTimestamp) {
            await fulfillPendingNote_({ db, email: data.email, tsISO: pendingNoteId }); 
        }
        
    } else if (data.type === 'Trả') { // --- LOGIC TRẢ/ĐỐI CHIẾU ---
        const tickets = data.tickets || []; // Dùng cho đối chiếu Sổ
        const itemsR = data.items || []; // Dùng cho trả không sử dụng
        const note = data.note || '';
        const ts = data.timestamp ? new Date(data.timestamp) : new Date();
        const selfNoteId = ts.toISOString(); 

        // XÁC ĐỊNH LOGIC: KTV Gửi note, Manager xác nhận trả, hay KTV đối chiếu
        const isKtvReturnNote = itemsR.length === 0 && tickets.length === 0 && !!note;
        const isManagerConfirmReturn = itemsR.length > 0 && !!data.date;
        const isKtvReconcile = tickets.length > 0;

        // 1. KTV GỬI NOTE TRẢ (MỚI)
        if (isKtvReturnNote) {
            await db.collection(PENDING_RETURN_NOTES_COLLECTION).add({
                timestamp: selfNoteId,
                type: 'Trả', 
                email: data.email, 
                date: data.date, 
                note: note, 
                isFulfilled: false,
                status: 'Pending',
                createdAt: new Date().toISOString()
            });
            // Ghi 1 dòng note vào Lịch sử (giống Mượn)
             rows.push([ ts, 'Trả', data.email, data.date, '', '', 0, note, 'NOTE', selfNoteId ]);
        }
        
        // 2. KTV XÁC NHẬN ĐỐI CHIẾU SỔ (LOGIC CŨ)
        // 2. KTV XÁC NHẬN ĐỐI CHIẾU SỔ
        // 2. KTV XÁC NHẬN ĐỐI CHIẾU SỔ 
else if (isKtvReconcile) {
    console.log('!!! RUNNING LATEST KTV RECONCILE CODE !!!');
    console.log(`[DEBUG Reconcile] Received tickets: ${JSON.stringify(tickets)}`);

    if (tickets.length > 0) {
        const sheetName = 'Đối chiếu sổ 3 liên';
        const updateRequests = [];
        const ticketsToUpdate = new Set((tickets || []).map(t => (t ?? '').toString().trim()));

        try {
            // 1. Đọc toàn bộ sheet 'Đối chiếu sổ 3 liên'
            console.log(`[DEBUG Reconcile] Reading sheet: ${sheetName}!A:H`);
            const readResult = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A:H`,
            });
            const values = readResult.data.values || [];
            console.log(`[DEBUG Reconcile] Read ${values.length - 1} data rows from sheet.`);

            // 2. Lặp qua từng hàng để tìm dòng cần cập nhật
            const norm = s => (s || '').toString().trim().toLowerCase();
            for (let i = 1; i < values.length; i++) { // bỏ header
                const row = values[i];
                if (row.length < 8) continue;

                const ticketInSheet = (row[3] || '').toString().trim(); // ✅ Cột D = Số sổ
                const statusInSheet = (row[7] || '').toString().trim(); // H = Trạng thái
                const rowIndex = i + 1; // 1-based

                const isPending =
                    norm(statusInSheet) === 'chưa đối chiếu' ||
                    norm(statusInSheet) === '' ||
                    norm(statusInSheet) === 'pending';

                if (ticketsToUpdate.has(ticketInSheet) && isPending) {
                    console.log(`[DEBUG Reconcile] Match found for ticket ${ticketInSheet} at row ${rowIndex}. Adding update request.`);
                    updateRequests.push({
                        range: `${sheetName}!H${rowIndex}`,
                        values: [['Đã đối chiếu']]
                    });
                }
            }

            console.log(`[DEBUG Reconcile] Prepared ${updateRequests.length} update requests:`, JSON.stringify(updateRequests));

            // 3. Gửi batch update lên Google Sheets
            if (updateRequests.length > 0) {
                console.log(`[DEBUG Reconcile] Attempting batchUpdate...`);
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: updateRequests
                    }
                });
                console.log(`[DEBUG Reconcile] batchUpdate successful. Updated rows: ${updateRequests.length}`);
                return { ok: true, updated: updateRequests.length };
            } else {
                console.warn(`[WARN Reconcile] No valid rows found to update for tickets: ${JSON.stringify(tickets)}`);
                return { ok: false, updated: 0, message: 'Không tìm thấy dòng nào để cập nhật.' };
            }

        } catch (sheetError) {
            console.error('!!! ERROR during Sheet read/update in Reconcile:', sheetError);
            throw new Error("Lỗi khi cập nhật trạng thái đối chiếu trên Google Sheet: " + sheetError.message);
        }
    } else {
        console.warn('[WARN Reconcile] tickets array is empty.');
        return { ok: false, updated: 0, message: 'Không có ticket nào được gửi.' };
    }
}
        
        // 3. QUẢN LÝ XÁC NHẬN TRẢ KHÔNG SỬ DỤNG (CẬP NHẬT)
        else if (isManagerConfirmReturn) {
            itemsR.forEach(it => {
                rows.push([ new Date(), 'Trả', data.email, data.date, utils.normalizeCode(it.code), it.name, Number(it.quantityReturned) || 0, data.note || 'Trả vật tư không sử dụng', 'WEBAPP', '' ]);
            });

            // Nếu Quản lý xác nhận dựa trên Note, fulfill note đó
            if (data.returnTimestamp) {
                await fulfillPendingReturnNote_({ db, email: data.email, tsISO: data.returnTimestamp }); 
            }
        }
    }
    // GHI DỮ LIỆU LỊCH SỬ VÀO SHEET (10 CỘT)
    if (rows.length > 0) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Lịch sử Mượn Trả Vật Tư!A:J', 
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows },
        });
    }
    return true;
}

/**
 * Đánh dấu Pending RETURN Note là Fulfilled
 */
async function fulfillPendingReturnNote_({ db, email, tsISO }) { 
    // const db = getDb();
    const normEmail = utils.normalizeCode(email);
    
    const snapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) 
        .where('isFulfilled', '==', false) 
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        await docRef.update({
            isFulfilled: true,
            fulfilledAt: new Date().toISOString()
        });
        return true;
    }
    return false;
}

/**
 * Đánh dấu Pending RETURN Note là Rejected
 */
async function rejectPendingReturnNote_({ db, email, tsISO, reason }) { 
    // const db = getDb();
    const normEmail = utils.normalizeCode(email);
    
    const snapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) 
        .where('isFulfilled', '==', false) //
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        await docRef.update({
            isFulfilled: true, // Đánh dấu là đã xử lý
            status: 'Rejected', // Trạng thái mới
            rejectionReason: reason,
            fulfilledAt: new Date().toISOString()
        });
        return true;
    }
    return false;
}

/**
 * Đánh dấu Pending BORROW Note là Rejected
 */
async function rejectPendingBorrowNote_({ db, email, tsISO, reason }) {
    // const db = getDb();
    const normEmail = utils.normalizeCode(email);

    const snapshot = await db.collection(PENDING_NOTES_COLLECTION) // Use the BORROW notes collection
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .where('isFulfilled', '==', false)
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        await docRef.update({
            isFulfilled: true, // Mark as processed
            status: 'Rejected', // Set new status
            rejectionReason: reason,
            fulfilledAt: new Date().toISOString()
        });
        return true;
    }
    return false;
}
// functions/data-processor.js (fulfillPendingNote_ đã sửa lỗi - Tăng cường an toàn)

// =======================================================
// HÀM PHỤ TRỢ MỚI: Dùng cho việc tìm và cập nhật Firestore
// =======================================================
/**
 * Đánh dấu Pending Note là Fulfilled bằng cách tìm kiếm theo timestamp.
 */

async function fulfillPendingNote_({ db, email, tsISO }) { 
    // const db = getDb(); // Lấy db an toàn
    const normEmail = utils.normalizeCode(email);
    
    // 1. Tìm tài liệu (Document) theo Timestamp và Email
    const snapshot = await db.collection(PENDING_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) 
        .where('isFulfilled', '==', false) 
        .limit(1)
        .get();

    if (!snapshot.empty) {
        // 2. Cập nhật tài liệu 
        const docRef = snapshot.docs[0].ref;
        await docRef.update({
            isFulfilled: true,
            fulfilledAt: new Date().toISOString()
        });
        return true;
    }
    return false;
}

// =======================================================
// 4. CÁC HÀM QUẢN LÝ (getTicketRanges, saveTicketRanges, etc.)
// =======================================================
// ... (Các hàm khác: getTicketRanges, getTechnicians, getItemList, v.v.) ...

async function submitErrorReport({ sheets, spreadsheetId, data }) {
    const rows = [
        [
            new Date().toISOString(),
            data.email || '',
            data.errorType || '',
            data.description || '',
            data.relatedTicketOrDate || '',
            data.suggestedFix || ''
        ]
    ];
    
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Báo cáo sai sót!A:F', 
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: rows },
    });
    return true;
}
// Tái tạo processExcelData (Giả định dữ liệu đã là JSON từ client)
// functions/data-processor.js (FIXED - Đảm bảo nhận sheets/spreadsheetId)
// =======================================================
// 5. XỬ LÝ EXCEL (processExcelData)
// =======================================================
// Tái tạo processExcelData (Chuẩn hóa JSON đã gửi từ Client)
async function processExcelData({ sheets, spreadsheetId, data }) {
    // NOTE: Cần đọc lại TicketRanges vì không được cache trong GCF
    const { ticketRangesMap } = await readAllSheetsData({ sheets, spreadsheetId, email: null }); 
    
    // / <-- THÊM LOG NÀY ĐỂ XEM DỮ LIỆU ĐỌC ĐƯỢC -->
    console.log('[DEBUG] ticketRangesMap loaded:', JSON.stringify(ticketRangesMap, null, 2));
    const processed = (data || []).map(row => {
        
        // --- LOGIC CHUYỂN ĐỔI NGÀY THÁNG EXCEL ---
        let parsedDate = row.date;
        if (typeof parsedDate === 'number') {
            // Excel serial number (ví dụ: 45749) sang Date Object (trừ đi 25569)
            // và định dạng lại thành DD/MM/YYYY
            const dateObj = new Date((parsedDate - 25569) * 86400 * 1000);
            if (!isNaN(dateObj.getTime())) {
                parsedDate = utils.fmtDate(dateObj); // Sử dụng helper fmtDate đã có
            }
        }
        // --- KẾT THÚC LOGIC CHUYỂN ĐỔI ---

        let ticket = (row.ticket == null) ? '' : String(row.ticket);
        if (ticket && !/^Sổ\s+/i.test(ticket)) ticket = 'Sổ ' + ticket.replace(/^Sổ\s*/i, '').trim();
        
        let email = row.email || '';
        const numMatch = ticket.match(/\d+/);
        
        // Gán email từ Ticket Ranges nếu chưa có
        if (!email && numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (isFinite(num)) {
                email = utils.getEmailByTicketNumber(num, ticketRangesMap);
            }
        }

        return {
            date: parsedDate || row.date || '', // Sử dụng ngày đã chuẩn hóa
            itemCode: utils.normalizeCode(row.itemCode || ''),
            itemName: (row.itemName || '').toString().trim(),
            ticket: ticket,
            quantity: Number(row.quantity) || 0,
            email: (email || '').toString().trim(),
            note: row.note || ''
        };
    });
    return processed;
}

// Tái tạo saveExcelData
/**
 * Lưu dữ liệu Excel đã xử lý vào sheet 'Đối chiếu sổ 3 liên', xử lý trùng lặp.
 */
async function saveExcelData({ sheets, spreadsheetId, data }) {
    if (!data || data.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ để lưu.');
    }

    const sheetName = 'Đối chiếu sổ 3 liên';
    const rangeToRead = `${sheetName}!A:H`; // Đọc các cột A-H

    // 1. Đọc dữ liệu hiện có từ Sheet
    let existingDataMap = new Map(); // Key: "Ticket_ItemCode", Value: { rowIndex, status }
    let headerRowSkipped = false;
    try {
        const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: rangeToRead,
        });
        const values = readResult.data.values || [];

        // Bỏ qua header (hàng 0), bắt đầu từ hàng 1 (index 0 sau khi bỏ header)
        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            const ticket = row[3] || ''; // Cột D = Số sổ
            const itemCode = utils.normalizeCode(row[1] || ''); // Cột B = Mã vật tư
            const status = row[7] || ''; // Cột H = Trạng thái

            if (ticket && itemCode) {
                const key = `${ticket}_${itemCode}`;
                const rowIndex = i + 1; // Row index (1-based) trong sheet
                existingDataMap.set(key, { rowIndex, status });
            }
        }
        headerRowSkipped = true; // Đánh dấu đã xử lý xong việc đọc
    } catch (err) {
        console.error("Lỗi đọc sheet 'Đối chiếu sổ 3 liên':", err);
        throw new Error("Không thể đọc dữ liệu hiện có để kiểm tra trùng lặp.");
    }


    // 2. Phân loại dữ liệu mới (Append hoặc Update)
    const rowsToAppend = [];
    const updateRequests = []; // Dùng cho batchUpdate

    data.forEach(r => {
        // Chuẩn bị dữ liệu hàng mới (giống code cũ)
        const ticket = r.ticket || '';
        const itemCode = utils.normalizeCode(r.itemCode || '');
        if (!ticket || !itemCode) return; // Bỏ qua nếu thiếu ticket hoặc itemCode

        const key = `${ticket}_${itemCode}`;
        const existingEntry = existingDataMap.get(key);

        // Chuẩn bị dữ liệu cho ô (theo đúng 8 cột A-H)
        const rowData = [
            r.date || '',         // A: Ngày
            r.itemCode || '',     // B: Mã VT
            r.itemName || '',     // C: Tên VT
            ticket,               // D: Số sổ
            Number(r.quantity) || 0, // E: Số lượng
            r.email || '',        // F: Email KTV
            r.note || '',         // G: Ghi chú
            'Chưa đối chiếu'      // H: Trạng thái
        ];

        if (existingEntry) {
            // Đã tồn tại
            if (existingEntry.status === 'Chưa đối chiếu') {
                // Tồn tại và chưa đối chiếu -> Cập nhật
                updateRequests.push({
                    range: `${sheetName}!A${existingEntry.rowIndex}:H${existingEntry.rowIndex}`, // Cập nhật cả hàng A-H
                    values: [rowData] // Dữ liệu mới
                });
            } else {
                // Tồn tại và ĐÃ đối chiếu -> Bỏ qua
                console.log(`Skipping update for already reconciled ticket ${ticket}, item ${itemCode}`);
            }
        } else {
            // Chưa tồn tại -> Thêm mới
            rowsToAppend.push(rowData); // Chỉ thêm dữ liệu hàng
        }
    });

    // 3. Thực hiện ghi vào Sheet
    try {
        // Thực hiện Append trước (nếu có)
        if (rowsToAppend.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${sheetName}!A:H`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: rowsToAppend },
            });
            console.log(`Appended ${rowsToAppend.length} new rows.`);
        }

        // Thực hiện BatchUpdate (nếu có)
        if (updateRequests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: updateRequests
                }
            });
            console.log(`Updated ${updateRequests.length} existing rows.`);
        }

        return { ok: true, message: `Lưu thành công. Thêm mới ${rowsToAppend.length} dòng, cập nhật ${updateRequests.length} dòng.` };

    } catch (err) {
        console.error("Lỗi ghi dữ liệu Excel vào Sheet:", err);
        throw new Error("Xảy ra lỗi khi lưu dữ liệu vào Google Sheet.");
    }
}

// Tái tạo consumeBorrowNote (đánh dấu Pending Note là Fulfilled)
async function consumeBorrowNote({ sheets, spreadsheetId, email, timestamp }) {
    // Logic này phức tạp: cần tìm dòng trong Pending Notes và cập nhật cột Fulfilled
    
    // NOTE: CẦN TÁI TẠO LOGIC TÌM DÒNG VÀ UPDATE TRẠNG THÁI PENDING NOTE
    // Tạm thời chỉ ghi nhận logic:
    console.log(`Fulfilling pending note: ${timestamp} for ${email}`);
    
    // Hàm findAndGetRows có thể được sử dụng để tìm vị trí dòng (rowNumber)
    // Sau đó dùng sheets.spreadsheets.values.update để cập nhật cột F (Fulfilled) và G (FulfilledAt)
    // ...
    
    return true;
}
/**
 * Tìm dòng trong sheet (1-based index) dựa trên giá trị cột.
 * NOTE: Logic này đọc toàn bộ sheet, chỉ dùng cho các sheet nhỏ (TicketRanges, PendingNotes).
 */
async function findAndGetRows(sheets, spreadsheetId, sheetName, checkColIndex, checkValues) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A:Z` // Đọc toàn bộ sheet
    });
    
    const rows = response.data.values || [];
    const updateRequests = [];
    const firstDataRow = 2; // Dữ liệu bắt đầu từ dòng 2
    
    rows.forEach((row, index) => {
        const rowNumber = index + firstDataRow;
        if (row.length > checkColIndex) {
            const cellValue = row[checkColIndex];
            if (checkValues.includes(cellValue)) {
                updateRequests.push({ rowNumber, values: row });
            }
        }
    });
    return updateRequests;
}
// =======================================================
// 6. XÁC THỰC VÀ ĐĂNG KÝ (verifyAndRegisterUser)
// =======================================================
async function verifyAndRegisterUser({ sheets, spreadsheetId, email, name }) {
    const normEmail = utils.normalizeCode(email);
    const techSheetName = 'Danh sách kỹ thuật viên';
    
    // 1. Kiểm tra xem user đã là quản lý chưa (Sử dụng hàm đã có)
    const isManager = await checkManager({ sheets, spreadsheetId, email });

    // 2. Đọc danh sách KTV hiện tại
    const techsResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${techSheetName}!A:A`, // Chỉ đọc cột Email
    });
    const currentEmails = (techsResult.data.values || []).map(row => utils.normalizeCode(row[0]));

    // 3. Nếu KTV chưa có trong danh sách, thêm vào
    if (!currentEmails.includes(normEmail)) {
        const newRow = [[email, name, new Date().toISOString()]]; // Cột: Email, Tên, Ngày đăng ký
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${techSheetName}!A:C`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: newRow },
        });
    }

    return { email, name, isManager };
}
async function rejectReturnNote({ db, data }) {
    const { email, timestamp, reason } = data;
    if (!email || !timestamp || !reason) {
        throw new Error('Thiếu email, timestamp, hoặc lý do từ chối.');
    }
    
    const success = await rejectPendingReturnNote_({
        db, 
        email: email,
        tsISO: timestamp,
        reason: reason
    });
    
    if (!success) {
        throw new Error('Không tìm thấy note trả hàng đang chờ, hoặc note đã được xử lý.');
    }
    return { ok: true, message: 'Note rejected successfully.' };
}
async function rejectBorrowNote({ db, data }) {
    const { email, timestamp, reason } = data;
    if (!email || !timestamp || !reason) {
        throw new Error('Thiếu email, timestamp, hoặc lý do từ chối.');
    }

    const success = await rejectPendingBorrowNote_({ // Call the correct helper
        db, 
        email: email,
        tsISO: timestamp,
        reason: reason
    });

    if (!success) {
        throw new Error('Không tìm thấy note mượn hàng đang chờ, hoặc note đã được xử lý.');
    }
    return { ok: true, message: 'Note rejected successfully.' };
}

/**
 * Lấy danh sách email KTV có note mượn và trả đang chờ (chưa fulfilled, chưa rejected)
 */
async function getPendingCounts({ db }) {
    let pendingBorrowEmails = [];
    let pendingReturnEmails = [];

    try {
        // Lấy note mượn đang chờ
        const borrowSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected']) // Vẫn dùng not-in
            .get(); // Dùng get() để lấy documents

        const borrowEmailsSet = new Set(); // Dùng Set để tránh trùng lặp email
        borrowSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.email) {
                borrowEmailsSet.add(data.email);
            }
        });
        pendingBorrowEmails = Array.from(borrowEmailsSet); // Chuyển Set thành Array

        // Lấy note trả đang chờ
        const returnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected']) // Vẫn dùng not-in
            .get(); // Dùng get()

        const returnEmailsSet = new Set();
        returnSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.email) {
                returnEmailsSet.add(data.email);
            }
        });
        pendingReturnEmails = Array.from(returnEmailsSet);

        // Trả về danh sách email
        return { pendingBorrowEmails, pendingReturnEmails };

    } catch (error) {
        console.error("Error getting pending counts/emails:", error);
        // Trả về mảng rỗng nếu có lỗi
        return { pendingBorrowEmails: [], pendingReturnEmails: [] };
    }
}
async function managerTransferItems({ sheets, spreadsheetId, db, data }) {
    const { fromEmail, toEmail, date, items } = data;

    console.log('[DEBUG managerTransferItems] Function CALLED with data:', JSON.stringify(data, null, 2)); // <-- LOG 1: Dữ liệu nhận được
    if (!fromEmail || !toEmail || !date || !items || items.length === 0) {
        throw new Error('Thiếu thông tin người chuyển, người nhận, ngày hoặc vật tư.');
    }
    if (fromEmail === toEmail) {
        throw new Error('Người chuyển và người nhận phải khác nhau.');
    }

    // 1. Lấy tên KTV từ Sheet (Ưu tiên) hoặc Firestore
    let fromName = fromEmail;
    let toName = toEmail;
    try {
        // Cố gắng đọc từ Sheet trước
        const techResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Danh sách kỹ thuật viên!A2:B', // Email(A), Tên(B)
        });
        const techs = techResponse.data.values || [];
        const techMap = new Map(techs.map(row => [utils.normalizeCode(row[0]), row[1] || row[0]]));
        fromName = techMap.get(utils.normalizeCode(fromEmail)) || fromEmail;
        toName = techMap.get(utils.normalizeCode(toEmail)) || toEmail;
        //console.log(`[managerTransferItems] Found names from Sheet: ${fromName}, ${toName}`);
        console.log(`[DEBUG managerTransferItems] Fetched names: From=${fromName}, To=${toName}`); // <-- LOG 2: Tên lấy được
    } catch (sheetError) {
         console.warn("Không thể lấy tên KTV từ Sheet, thử Firestore:", sheetError.message);
         // Thử đọc từ Firestore nếu đọc Sheet lỗi (dự phòng)
         try {
             const usersRef = db.collection('users'); // Giả sử collection user là 'users'
             const fromSnap = await usersRef.where('email', '==', fromEmail).limit(1).get();
             const toSnap = await usersRef.where('email', '==', toEmail).limit(1).get();
             if (!fromSnap.empty) fromName = fromSnap.docs[0].data().name || fromEmail;
             if (!toSnap.empty) toName = toSnap.docs[0].data().name || toEmail;
             console.log(`[managerTransferItems] Found names from Firestore: ${fromName}, ${toName}`);
         } catch (firestoreError) {
             console.error("Không thể lấy tên KTV từ Firestore:", firestoreError.message);
             // Giữ nguyên email nếu cả 2 đều lỗi
         }
    }

    // 2. Chuẩn bị các hàng để ghi vào lịch sử
    const rowsToAppend = [];
    const timestamp = new Date();

    items.forEach(item => {
        const code = utils.normalizeCode(item.code);
        const quantity = Number(item.quantity) || 0;
        if (code && quantity > 0) {
            rowsToAppend.push([
                timestamp, 'Trả', fromEmail, date, code, item.name || '', quantity, `Chuyển cho ${toName}`, 'TRANSFER', ''
            ]);
            rowsToAppend.push([
                timestamp, 'Mượn', toEmail, date, code, item.name || '', quantity, `Nhận từ ${fromName}`, 'TRANSFER', ''
            ]);
        }
    });
    // 3. Ghi vào Google Sheet
    if (rowsToAppend.length > 0) {
        try { // <-- THÊM try...catch quanh lệnh append -->
            console.log('[DEBUG managerTransferItems] Attempting to append to Sheet...'); // <-- LOG 4: Trước khi gọi API
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Lịch sử Mượn Trả Vật Tư!A:J', // Kiểm tra lại range
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: rowsToAppend },
            });
            console.log('[DEBUG managerTransferItems] Append successful.'); // <-- LOG 5: Sau khi gọi API thành công
        } catch (appendError) { // <-- Bắt lỗi append -->
             console.error('!!! ERROR appending transfer data to Sheet:', appendError); // <-- LOG 6: Lỗi cụ thể
             // Ném lại lỗi để frontend biết
             throw new Error("Lỗi khi ghi dữ liệu chuyển giao vào Google Sheet: " + appendError.message);
        }
    } else {
        // Log nếu không có gì để ghi (ít khả năng xảy ra do đã kiểm tra trước)
        console.warn('[WARN managerTransferItems] No valid rows to append.');
        throw new Error('Không có vật tư hợp lệ để chuyển.');
    }

    return { ok: true, message: 'Chuyển vật tư thành công.' };
}
// ... (Xuất module) ...
module.exports = {
    checkManager,
    getTechnicianDashboardData,
    getTechnicians,
    getItemList,
    submitTransaction,
    getBorrowHistory,
    getTicketRanges,
    saveTicketRanges,
    submitErrorReport,
    // Các hàm mới bổ sung:
    processExcelData, 
    saveExcelData, 
    consumeBorrowNote,
    verifyAndRegisterUser,
    rejectReturnNote,
    getReturnHistory,
    rejectBorrowNote,
    getPendingCounts,
    managerTransferItems,
};