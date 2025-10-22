// functions/data-processor.js (FIXED - Logic Firestore)

const utils = require('./utils');
const { google } = require('googleapis');
const admin = require('firebase-admin'); 

// Hằng số cho Collection IDs
const PENDING_NOTES_COLLECTION = 'pending_notes';
const USAGE_TICKETS_COLLECTION = 'usage_tickets';
const PENDING_RETURN_NOTES_COLLECTION = 'pending_return_notes';

// FIX: Hàm tiện ích để lấy Firestore Client (sẽ chỉ chạy sau khi index.js gọi initializeApp)
const getDb = () => {
    try {
        return admin.firestore();
    } catch (e) {
        // Lỗi này KHÔNG nên xảy ra nếu index.js được cấu hình đúng.
        console.error("Firestore initialization error: Make sure admin.initializeApp() is called.");
        throw e;
    }
};
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
async function readAllSheetsData({ sheets, spreadsheetId, email }) {
    // FIX: THÊM KIỂM TRA AN TOÀN TRƯỚC KHI TRUY CẬP SHEETS API
    if (!sheets || !sheets.spreadsheets || !sheets.spreadsheets.values) {
        // Trả về một lỗi có thể xử lý được nếu client không tồn tại
        throw new Error("Sheets API Client is unavailable for reading data.");
    }
    
    // NOTE: Đã loại bỏ PendingNotes Sheet (Index 5)
    const ranges = [
        'Danh sách kỹ thuật viên!A2:B', // 0: techs
        'Danh sách vật tư!A2:B',        // 1: items
        'TicketRanges!A2:C',            // 2: ranges
        'Lịch sử Mượn Trả Vật Tư!A2:J', // 3: history
        'Đối chiếu sổ 3 liên!A2:H',      // 4: comparison
    ];

    const sheetsResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ranges
    });

    const valueRanges = sheetsResponse.data.valueRanges || [];

    // HÀNH ĐỘNG: Đảm bảo mọi kết quả đều có .values và .values là Array
    const safeGetValues = (index) => (valueRanges[index] && valueRanges[index].values) || [];

    const safeTechs = safeGetValues(0);
    const safeItems = safeGetValues(1);
    const safeRanges = safeGetValues(2);
    const safeHistory = safeGetValues(3);
    const safeComparison = safeGetValues(4);
    
    // Chuyển đổi dữ liệu thô sang Map/Array dễ dùng
    const itemCodeMap = new Map();
    safeItems.forEach(row => {
        const code = utils.normalizeCode(row[0]);
        if (code) itemCodeMap.set(code, row[1] || 'Không xác định');
    });

    const ticketRangesMap = safeRanges.map(row => ({
        email: utils.normalizeCode(row[0]),
        start: Number(row[1]) || 0,
        end: Number(row[2]) || 0,
    }));
    
    return {
        techs: safeTechs,
        itemCodeMap,
        ticketRangesMap,
        history: safeHistory,
        comparison: safeComparison,
    };
}
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
async function getTechnicianDashboardData({ sheets, spreadsheetId, email, isManager }) {
    const normEmail = utils.normalizeCode(email).toLowerCase();
    
    // START DEBUG LOG: Ghi lại email đang được sử dụng để truy vấn
    console.log(`[DEBUG] Querying Firestore for email: ${normEmail}`);
    
    // Đọc tất cả các Sheets cần thiết (KHÔNG BAO GỒM PendingBorrowNotes SHEET)
    const { itemCodeMap, ticketRangesMap, history, comparison } = await readAllSheetsData({ sheets, spreadsheetId, email: normEmail });
    
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

    // B. Xử lý logic Đối chiếu Sổ (Usage)
    comparison.forEach(row => {
        // Cột: 0:Ngày, 1:Mã vật tư, 2:Tên vật tư, 3:Email, 4:Số sổ, 5:Số lượng sử dụng, 6:Ghi chú, 7:Trạng thái
        const uEmail = utils.normalizeCode(row[3]);
        const ticket = row[4] || '';
        const status = (row[7] || '').toString().trim();

        // Tính email nếu trường email trống
        const ticketOwnerEmail = utils.getEmailByTicketNumber(ticket, ticketRangesMap);
        const effectiveEmail = uEmail || ticketOwnerEmail;
        if (normEmail && utils.normalizeCode(effectiveEmail) !== normEmail) return;

        const uCode = utils.normalizeCode(row[1] || '');
        const qUsed = Number(row[5]) || 0;
        const uNote = row[6] || '';

        if (!uCode || qUsed <= 0) return;
        
        if (!byCode[uCode]) {
            byCode[uCode] = { code: uCode, name: itemCodeMap.get(uCode) || '', quantity: 0, totalUsed: 0, totalReturned: 0, unreconciledUsageDetails: [], reconciledUsageDetails: [] };
        }

        if (status === 'Chưa đối chiếu') {
            byCode[uCode].unreconciledUsageDetails.push({ ticket, quantity: qUsed, note: uNote });
            byCode[uCode].totalUsed += qUsed;
        } else {
            byCode[uCode].reconciledUsageDetails.push({ ticket, quantity: qUsed, note: uNote });
            if (status === 'Đã đối chiếu') {
                totalReconciledUsed[uCode] = (totalReconciledUsed[uCode] || 0) + qUsed;
            }
        }
    });

    // C. Tổng hợp kết quả cuối cùng (giống logic Apps Script)
    const items = Object.keys(byCode).map(k => {
        const it = byCode[k];
        const reconciledUsed = totalReconciledUsed[it.code] || 0;

        // Tổng mượn chưa trả = Mượn - Trả về kho - Đã Sử dụng (ĐÃ ĐỐI CHIẾU)
        const quantityAfterReconciliation = Math.max(0, it.quantity - it.totalReturned - reconciledUsed); 
        
        // Số lượng còn lại cần đối chiếu (dùng cho Overview)
        const remaining = quantityAfterReconciliation - it.totalUsed; 

        return {
            code: it.code,
            name: it.name,
            quantity: quantityAfterReconciliation, 
            totalUsed: it.totalUsed,
            totalReturned: it.totalReturned,
            unreconciledUsageDetails: it.unreconciledUsageDetails,
            reconciledUsageDetails: it.reconciledUsageDetails,
            remaining: remaining
        };
    }).filter(a => 
        a.quantity > 0 ||                 // 1. Vẫn còn nợ
        a.totalUsed > 0 ||                 // 2. Vẫn còn sổ CHƯA đối chiếu
        (a.reconciledUsageDetails && a.reconciledUsageDetails.length > 0) // 3. HOẶC có lịch sử ĐÃ đối chiếu
    );
    
    /// D. Xử lý Pending Notes (Truy vấn FIRESTORE)
    const db = getDb(); // Lấy Firestore client

    // D.1. Lấy Pending Borrow Notes
    const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('isFulfilled', '==', false)
        .orderBy('createdAt', 'desc') // FIX: Buộc sử dụng trường createdAt (đã xác nhận tồn tại)
        .get();

    const pendingNotesRaw = pendingSnapshot.docs.map(doc => {
        return doc.data();
    });

    // Sắp xếp Node.js không cần thiết nếu orderBy Firestore thành công
    const pendingNotes = pendingNotesRaw
        .map(data => {
            return {
                timestamp: data.timestamp, // Giữ nguyên để khớp với client
                note: data.note, 
                date: data.date,
            };
        });
    // D.2. LẤY PENDING RETURN NOTES (THÊM KHỐI NÀY)
    const pendingReturnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('isFulfilled', '==', false)
        //.orderBy('createdAt', 'desc')
        .get();
        
    const pendingReturnNotesRaw = pendingReturnSnapshot.docs.map(doc => {
        return doc.data();
    });
    
    const pendingReturnNotes = pendingReturnNotesRaw
        .map(data => {
            return {
                timestamp: data.timestamp,
                note: data.note, 
                date: data.date,
            };
        });
    return {
        items: items,
        pendingNotes: pendingNotes, // Dữ liệu từ Firestore đã được sắp xếp
        pendingReturnNotes: pendingReturnNotes,
        // ... (các trường khác) ...
    };
}


// =======================================================
// 2. LỊCH SỬ (getBorrowHistory)
// =======================================================
async function getBorrowHistory({ sheets, spreadsheetId, email, dateStr = null, isLast5Days = false, currentPage, pageSize }) {
    const { itemCodeMap, history } = await readAllSheetsData({ sheets, spreadsheetId, email });
    const normEmail = utils.normalizeCode(email);
    
    const now = new Date();
    const fiveDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5); 
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
        const pendingNoteId = row[9] || '';

        if (type !== 'Mượn') return;
        if (normEmail && eml !== normEmail) return;

        const tsDate = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(tsDate.getTime())) return;

        if (dateStr && ngay !== dateStr) return;
        
        if (isLast5Days) {
            const rowDay = new Date(tsDate.getFullYear(), tsDate.getMonth(), tsDate.getDate());
            if (rowDay < fiveDaysAgo) return; 
        }

        // TẠO KEY GROUPING: Ưu tiên PendingNoteID, nếu không có thì dùng Timestamp
        const key = pendingNoteId || tsDate.toISOString();
        
        // 1. Khởi tạo/Cập nhật Bucket:
        if (!buckets[key]) {
            buckets[key] = { timestamp: tsDate.toISOString(), date: ngay, note: note, itemsEntered: {} }; 
        } else {
            if (note && (!buckets[key].note || note.length > buckets[key].note.length)) {
                buckets[key].note = note;
            }
        }

        // 2. Thêm Items:
        if (code && qty > 0) {
            const m = buckets[key].itemsEntered;
            if (!m[code]) m[code] = { code: code, name: itemCodeMap.get(code) || row[5], quantity: 0 };
            m[code].quantity += qty;
        }
    });

    const arr = Object.keys(buckets).map(k => buckets[k]);
    
    // Xử lý phân trang
    const totalItems = arr.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const start = (currentPage - 1) * pageSize;
    const historyPage = arr.slice(start, start + pageSize);
    
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
async function submitTransaction({ sheets, spreadsheetId, data }) {
    const db = getDb(); // Lấy db an toàn
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
                createdAt: new Date().toISOString()
            });
        }

        // 4. Nếu quản lý mượn theo lệnh chờ => Fulfilled pending
        if (data.borrowTimestamp) {
            await fulfillPendingNote_({ email: data.email, tsISO: pendingNoteId }); 
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
                createdAt: new Date().toISOString()
            });
            // Ghi 1 dòng note vào Lịch sử (giống Mượn)
             rows.push([ ts, 'Trả', data.email, data.date, '', '', 0, note, 'NOTE', selfNoteId ]);
        }
        
        // 2. KTV XÁC NHẬN ĐỐI CHIẾU SỔ (LOGIC CŨ)
        else if (isKtvReconcile) {
            if (tickets.length > 0) {
                const sheetName = 'Đối chiếu sổ 3 liên';
                
                // 1. Đọc toàn bộ sheet 'Đối chiếu sổ 3 liên'
                const readResult = await sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `${sheetName}!A:H`, // Đọc cột E (Sổ) và H (Trạng thái)
                });
                
                const values = readResult.data.values || [];
                const updateRequests = [];
                // Dùng Set để tra cứu các sổ cần update nhanh hơn
                const ticketsToUpdate = new Set(tickets); 

                // 2. Lặp qua từng hàng (bỏ qua header hàng 0)
                for (let i = 1; i < values.length; i++) {
                    const row = values[i];
                    if (row.length < 8) continue; // Bỏ qua hàng trống

                    const ticketInSheet = row[4] || ''; // Cột E = Số sổ (index 4)
                    const statusInSheet = row[7] || ''; // Cột H = Trạng thái (index 7)

                    // 3. Nếu sổ này nằm trong danh sách KTV chọn VÀ nó 'Chưa đối chiếu'
                    if (ticketsToUpdate.has(ticketInSheet) && statusInSheet === 'Chưa đối chiếu') {
                        const rowIndex = i + 1; // row index (1-based) cho Google Sheets
                        
                        // 4. Thêm yêu cầu cập nhật cho ô H (Trạng thái)
                        updateRequests.push({
                            range: `${sheetName}!H${rowIndex}`, // VD: 'Đối chiếu sổ 3 liên!H111'
                            values: [['Đã đối chiếu']]
                        });
                    }
                }

                // 5. Gửi batch update lên Google Sheets nếu có
                if (updateRequests.length > 0) {
                    await sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        resource: {
                            valueInputOption: 'USER_ENTERED',
                            data: updateRequests
                        }
                    });
                }
            }
        }
        
        // 3. QUẢN LÝ XÁC NHẬN TRẢ KHÔNG SỬ DỤNG (CẬP NHẬT)
        else if (isManagerConfirmReturn) {
            itemsR.forEach(it => {
                rows.push([ new Date(), 'Trả', data.email, data.date, utils.normalizeCode(it.code), it.name, Number(it.quantityReturned) || 0, data.note || 'Trả vật tư không sử dụng', 'WEBAPP', '' ]);
            });

            // Nếu Quản lý xác nhận dựa trên Note, fulfill note đó
            if (data.returnTimestamp) {
                await fulfillPendingReturnNote_({ email: data.email, tsISO: data.returnTimestamp }); 
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
async function fulfillPendingReturnNote_({ email, tsISO }) { 
    const db = getDb();
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
async function rejectPendingReturnNote_({ email, tsISO, reason }) { 
    const db = getDb();
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
// functions/data-processor.js (fulfillPendingNote_ đã sửa lỗi - Tăng cường an toàn)

// =======================================================
// HÀM PHỤ TRỢ MỚI: Dùng cho việc tìm và cập nhật Firestore
// =======================================================
/**
 * Đánh dấu Pending Note là Fulfilled bằng cách tìm kiếm theo timestamp.
 */

async function fulfillPendingNote_({ email, tsISO }) { 
    const db = getDb(); // Lấy db an toàn
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
async function saveExcelData({ sheets, spreadsheetId, data }) {
    if (!data || !data.length) throw new Error('Không có dữ liệu để lưu');
    
    const rows = [];
    data.forEach(r => {
        if (!r.date || !r.itemCode || !r.itemName || !r.ticket || r.quantity <= 0) return;

        rows.push([ r.date, r.itemCode, r.itemName, r.email || '', r.ticket, Number(r.quantity), r.note || '', 'Chưa đối chiếu' ]);
    });

    if (rows.length === 0) throw new Error('Không có dòng hợp lệ để lưu');

    // Ghi vào sheet Đối chiếu sổ 3 liên
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Đối chiếu sổ 3 liên!A:H',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: rows },
    });
    return true;
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
        email: email,
        tsISO: timestamp,
        reason: reason
    });
    
    if (!success) {
        throw new Error('Không tìm thấy note trả hàng đang chờ, hoặc note đã được xử lý.');
    }
    return { ok: true, message: 'Note rejected successfully.' };
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
};