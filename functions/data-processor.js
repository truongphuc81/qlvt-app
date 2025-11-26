// functions/data-processor.js (ĐÃ REFACTOR HOÀN TOÀN SANG FIRESTORE)

const utils = require('./utils');
const admin = require('firebase-admin');

// Hằng số Collection IDs
const PENDING_NOTES_COLLECTION = 'pending_notes';
const PENDING_RETURN_NOTES_COLLECTION = 'pending_return_notes';
const HISTORY_COLLECTION = 'history_transactions'; // MỚI
const USAGE_TICKETS_COLLECTION = 'usage_tickets'; // MỚI
let itemCodeMapCache = null;
let ticketRangesMapCache = null;
let coreCacheTimestamp = 0;
const CACHE_DURATION = 600000; // 10 phút (600,000 ms)
// === KẾT THÚC THÊM CACHE ===
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
// =======================================================
// HELPER TRUY CẬP SHEETS (CHỈ DÙNG CHO DỮ LIỆU ÍT THAY ĐỔI)
// =======================================================

/**
 * Chỉ đọc các sheet Danh mục (ít thay đổi), không đọc Lịch sử/Đối chiếu.
 * Đây là các hàm nên được cache trong tương lai.
 */
async function _readCoreSheetDataFromApi({ sheets, spreadsheetId }) {
    const itemCodeMap = new Map();
    const ticketRangesMap = [];

    try {
        // 1. Đọc Danh sách Vật tư
        const itemsResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Danh sách vật tư!A2:B',
        });
        (itemsResult.data.values || []).forEach(row => {
            if (row[0]) itemCodeMap.set(utils.normalizeCode(row[0]), row[1] || row[0]);
        });
    } catch (err) {
        console.warn("Lỗi đọc sheet Danh sách vật tư:", err.message);
    }

    try {
        // 2. Đọc Dải số sổ
        const rangesResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'TicketRanges!A2:C',
        });
        (rangesResult.data.values || []).forEach(row => {
            const emailR = row[0] || '';
            const start = Number(row[1]) || 0;
            const end = Number(row[2]) || 0;
            if (emailR && start > 0 && end >= start) {
                ticketRangesMap.push({ email: emailR, start, end });
            }
        });
    } catch (err) {
        console.warn("Lỗi đọc sheet TicketRanges:", err.message);
    }

    return { itemCodeMap, ticketRangesMap };
}
/**
 * [Hàm mới] Lấy dữ liệu lõi (Vật tư, Dải số) từ Cache hoặc API
 */
async function getCoreSheetData({ sheets, spreadsheetId }) {
    const now = Date.now();
    
    // Kiểm tra cache (cũ hơn 10 phút hoặc chưa có)
    if (!itemCodeMapCache || !ticketRangesMapCache || (now - coreCacheTimestamp > CACHE_DURATION)) {
        console.log('[Cache] Đang làm mới cache dữ liệu lõi (Vật tư, Dải số)...');
        
        // Gọi API
        const { itemCodeMap, ticketRangesMap } = await _readCoreSheetDataFromApi({ sheets, spreadsheetId });
        
        // Lưu vào cache
        itemCodeMapCache = itemCodeMap;
        ticketRangesMapCache = ticketRangesMap;
        coreCacheTimestamp = now;
        
        console.log(`[Cache] Làm mới thành công. ${itemCodeMapCache.size} vật tư, ${ticketRangesMapCache.length} dải số.`);
    } else {
        console.log('[Cache] Sử dụng cache dữ liệu lõi.');
    }
    
    return { itemCodeMap: itemCodeMapCache, ticketRangesMap: ticketRangesMapCache };
}
// =======================================================
// HELPER GHI DỮ LIỆU (DUAL WRITE)
// =======================================================

/**
 * (Async) Ghi Lịch sử vào Google Sheet (Dùng làm backup)
 * Hàm này không cần await, chạy ngầm.
 */
function writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc }) {
    const rows = [];
    const { timestamp, type, email, date, note, pendingNoteId, items } = transactionDoc;
    
    if (items && items.length > 0) {
        items.forEach(it => {
            rows.push([
                timestamp, type, email, date,
                utils.normalizeCode(it.code), it.name, Number(it.quantity) || 0,
                note, 'FIRESTORE_TX', pendingNoteId || ''
            ]);
        });
    } else {
        // Ghi note-only
        rows.push([
            timestamp, type, email, date,
            '', '', 0,
            note, 'FIRESTORE_NOTE', pendingNoteId || timestamp
        ]);
    }

    if (rows.length > 0) {
        sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Lịch sử Mượn Trả Vật Tư!A:J',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows },
        }).catch(err => {
            console.error("!!! LỖI GHI BACKUP HISTORY SHEET:", err.message);
        });
    }
}

/**
 * (Async) Ghi Dữ liệu Excel vào Google Sheet (Dùng làm backup)
 */
function writeUsageTicketsToSheet_({ sheets, spreadsheetId, data }) {
    const rowsToAppend = data.map(r => [
        r.date || '',
        r.itemCode || '',
        r.itemName || '',
        r.ticket,
        Number(r.quantity) || 0,
        r.email || '',
        r.note || '',
        r.status || 'Chưa đối chiếu'
    ]);
    
    if (rowsToAppend.length > 0) {
         sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Đối chiếu sổ 3 liên!A:H',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rowsToAppend },
        }).catch(err => {
            console.error("!!! LỖI GHI BACKUP USAGE SHEET:", err.message);
        });
    }
}

/**
 * (Async) Cập nhật trạng thái đối chiếu trên Google Sheet (Backup)
 */
async function updateUsageTicketStatusInSheet_({ sheets, spreadsheetId, tickets, email }) {
    // Logic này chậm và phức tạp, nhưng cần thiết cho backup
    try {
        const sheetName = 'Đối chiếu sổ 3 liên';
        const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:H`, // Đọc A-H
        });
        
        const values = readResult.data.values || [];
        const updateRequests = [];
        const ticketsToUpdate = new Set(tickets.map(t => (t || '').toString().trim()));
        const normEmail = utils.normalizeCode(email);

        for (let i = 1; i < values.length; i++) { // Bỏ qua header
            const row = values[i];
            const ticketInSheet = (row[3] || '').toString().trim(); // Cột D = Số sổ
            const emailInSheet = utils.normalizeCode(row[5] || ''); // Cột F = Email
            const statusInSheet = (row[7] || '').toString().trim(); // Cột H = Trạng thái
            const rowIndex = i + 1; // 1-based

            if (ticketsToUpdate.has(ticketInSheet) && 
                emailInSheet === normEmail && 
                statusInSheet.toLowerCase() === 'chưa đối chiếu') {
                
                updateRequests.push({
                    range: `${sheetName}!H${rowIndex}`,
                    values: [['Đã đối chiếu']]
                });
            }
        }

        if (updateRequests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updateRequests
                }
            });
        }
    } catch (sheetError) {
        console.error("!!! LỖI CẬP NHẬT BACKUP USAGE SHEET:", sheetError.message);
    }
}

// =======================================================
// 1. DASHBOARD DATA (Đọc 100% từ Firestore)
// =======================================================
async function getTechnicianDashboardData({ sheets, spreadsheetId, db, email, isManager }) {
    console.log(`[Firestore Dashboard] Đang tải dashboard cho: ${email}`);
    const normEmail = utils.normalizeCode(email).toLowerCase();
    
    // Đọc core data (tên VT) từ Sheet (Nên cache)
    // const { itemCodeMap } = await readCoreSheetData({ sheets, spreadsheetId });
    // Tạm thời bỏ qua itemCodeMap để tập trung vào Firestore
    const { itemCodeMap } = await getCoreSheetData({ sheets, spreadsheetId });

    const byCode = {};

    // A. Lấy Lịch sử Mượn/Trả từ Firestore
    try {
        const historySnapshot = await db.collection(HISTORY_COLLECTION)
            .where('email', '==', normEmail)
            .get();

        historySnapshot.forEach(doc => {
            const data = doc.data();
            const items = data.items || [];

            items.forEach(item => {
                // === THÊM KIỂM TRA TÍNH HỢP LỆ CỦA ITEM ===
                if (!item || typeof item !== 'object') {
                    console.warn(`[getTechnicianDashboardData] Bỏ qua item không hợp lệ trong history document ${doc.id}:`, item);
                    return; // Bỏ qua phần tử item này và đi tiếp
                }
                // === KẾT THÚC KIỂM TRA ===

                const code = utils.normalizeCode(item.code);

                // === THÊM KIỂM TRA CODE ===
                 if (!code) {
                    console.warn(`[getTechnicianDashboardData] Bỏ qua item thiếu hoặc mã không hợp lệ trong history document ${doc.id}:`, item);
                    return; // Bỏ qua item nếu mã không hợp lệ
                }
                // === KẾT THÚC KIỂM TRA ===


                if (!byCode[code]) {
                    byCode[code] = {
                        code,
                        // Đảm bảo item.name cũng được kiểm tra (dù lỗi không báo ở đây)
                        name: item.name || itemCodeMap.get(code) || code,
                        quantity: 0, totalUsed: 0, totalReturned: 0,
                        unreconciledUsageDetails: [], reconciledUsageDetails: []
                    };
                }
                // === KIỂM TRA VÀ LẤY QUANTITY AN TOÀN ===
                // Lấy quantity, nếu không có hoặc không phải số thì mặc định là 0
                const itemQuantity = Number(item.quantity) || 0;
                // === KẾT THÚC KIỂM TRA ===


                if (data.type === 'Mượn') {
                    byCode[code].quantity += itemQuantity; // Dùng biến đã kiểm tra
                } else if (data.type === 'Trả' && data.status === 'Fulfilled') {
                    byCode[code].totalReturned += itemQuantity; // Dùng biến đã kiểm tra
                }
            }); // Kết thúc items.forEach
        }); // Kết thúc historySnapshot.forEach
    } catch (e) { // Catch này giờ đã đúng vị trí
         console.error("Lỗi đọc Firestore HISTORY_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu lịch sử.");
    }

    // B. Lấy dữ liệu Đối chiếu sổ (Usage Tickets) từ Firestore
    try {
        const usageSnapshot = await db.collection(USAGE_TICKETS_COLLECTION)
            .where('email', '==', normEmail)
            .get();
            
        usageSnapshot.forEach(doc => {
            const data = doc.data();
            const itemCode = utils.normalizeCode(data.itemCode);
            const quantityUsed = Number(data.quantity) || 0;
            
            if (!itemCode || quantityUsed <= 0) return;

            if (!byCode[itemCode]) {
                byCode[itemCode] = { 
                    code: itemCode, 
                    name: data.itemName || itemCodeMap.get(itemCode) || itemCode, 
                    quantity: 0, totalUsed: 0, totalReturned: 0, 
                    unreconciledUsageDetails: [], reconciledUsageDetails: [] 
                };
            }
            
            const detail = { 
                ticket: data.ticket, 
                quantity: quantityUsed, 
                note: data.note || '' 
            };
            
            if (data.status === 'Chưa đối chiếu') {
                byCode[itemCode].unreconciledUsageDetails.push(detail);
                byCode[itemCode].totalUsed += quantityUsed;
            } else if (data.status === 'Đã đối chiếu') {
                byCode[itemCode].reconciledUsageDetails.push(detail);
                byCode[itemCode].totalUsed += quantityUsed;
            }
        });
    } catch (e) {
         console.error("Lỗi đọc Firestore USAGE_TICKETS_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu đối chiếu.");
    }
    
    // C. Tính toán và lọc
    const items = Object.values(byCode).map(data => {
        const remaining = (data.quantity - data.totalReturned) - data.totalUsed;
        return { ...data, remaining };
    }).filter(a =>
        a.quantity > 0 ||
        a.totalReturned > 0 ||
        a.totalUsed > 0 ||
        (a.unreconciledUsageDetails && a.unreconciledUsageDetails.length > 0) ||
        (a.reconciledUsageDetails && a.reconciledUsageDetails.length > 0)
    );

    // D. Lấy Pending Notes (Logic này giữ nguyên vì đã dùng Firestore)
    let pendingNotes = [];
    try {
        const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .get();
        pendingNotes = pendingSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Lỗi đọc PENDING_NOTES_COLLECTION:", e);
    }

    let pendingReturnNotes = [];
    try {
        const pendingReturnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        pendingReturnNotes = pendingReturnSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Lỗi đọc PENDING_RETURN_NOTES_COLLECTION:", e);
    }

    return { items, pendingNotes, pendingReturnNotes };
}

// =======================================================
// 2. LỊCH SỬ (Đọc 100% từ Firestore)
// =======================================================

async function getBorrowHistory({ db, email, dateStr = null, isLast5Days = false, currentPage, pageSize }) {
    const normEmail = utils.normalizeCode(email);
    
    // 1. Tạo query cơ bản
    let query = db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('type', '==', 'Mượn')
        .orderBy('timestamp', 'desc');

    // 2. Lọc theo ngày (nếu có)
    if (dateStr) {
        query = query.where('date', '==', dateStr);
    }
    if (isLast5Days) {
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
        query = query.where('timestamp', '>=', fiveDaysAgo.toISOString());
    }

    // 3. Phân trang (Tạm thời bỏ qua để lấy tổng số)
    // Cần 2 query: 1 để đếm, 1 để lấy data
    const totalSnapshot = await query.get();
    const totalItems = totalSnapshot.size;
    const totalPages = Math.ceil(totalItems / pageSize);

    // 4. Lấy dữ liệu trang hiện tại
    const pageQuery = query
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
        
    const historySnapshot = await pageQuery.get();

    // 5. Chuyển đổi dữ liệu cho frontend
    const history = historySnapshot.docs.map(doc => {
        const data = doc.data();
        
        // Chuyển đổi mảng items[] thành object itemsEntered{}
        const itemsEntered = {};
        if (data.items) {
            data.items.forEach(item => {
                itemsEntered[utils.normalizeCode(item.code)] = {
                    code: item.code,
                    name: item.name,
                    quantity: item.quantity
                };
            });
        }
        
        return {
            timestamp: data.timestamp,
            date: data.date,
            note: data.note,
            status: data.status,
            reason: data.rejectionReason || null,
            itemsEntered: itemsEntered
        };
    });
    
    return { history, totalPages };
}
/**
 * Kiểm tra vai trò Manager và Auditor cho user, tự đăng ký KTV nếu chưa có.
 */

async function getReturnHistory({ db, email, currentPage, pageSize }) {
    const normEmail = utils.normalizeCode(email);
    
    // Tương tự getBorrowHistory, nhưng 'type' == 'Trả'
    let query = db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('type', '==', 'Trả')
        .orderBy('timestamp', 'desc');

    const totalSnapshot = await query.get();
    const totalItems = totalSnapshot.size;
    const totalPages = Math.ceil(totalItems / pageSize);

    const pageQuery = query
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
        
    const historySnapshot = await pageQuery.get();

    const history = historySnapshot.docs.map(doc => {
        const data = doc.data();
        const itemsEntered = {};
        if (data.items) {
            data.items.forEach(item => {
                itemsEntered[utils.normalizeCode(item.code)] = {
                    code: item.code,
                    name: item.name,
                    quantity: item.quantity
                };
            });
        }
        return {
            timestamp: data.timestamp,
            date: data.date,
            note: data.note,
            status: data.status,
            reason: data.rejectionReason || null,
            itemsEntered: itemsEntered
        };
    });
    
    return { history, totalPages };
}


// =======================================================
// 3. SUBMIT TRANSACTION (Ghi vào Firestore & Sheets)
// =======================================================
async function submitTransaction({ sheets, spreadsheetId, db, data }) {
    console.log("[submitTransaction] Received data:", JSON.stringify(data, null, 2)); // Log dữ liệu đầu vào

    const ts = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
    const batch = db.batch();
    let transactionDoc; // Khai báo ở phạm vi rộng hơn

    // --- LOGIC MƯỢN (Đã có log từ trước, giữ nguyên) ---
    if (data.type === 'Mượn') {
        console.log("[submitTransaction] Processing 'Mượn' transaction...");
        const items = data.items || [];
        const note = data.note || '';
        const pendingNoteId = data.borrowTimestamp || '';
        const currentTs = ts;

        const isKtvSubmitNote = !pendingNoteId && data.mode !== 'DIRECT' && items.length === 0;
        const isManagerConfirmNote = !!pendingNoteId && items.length > 0;
        const isManagerDirect = data.mode === 'DIRECT' && items.length > 0;

        console.log(`[submitTransaction Mượn] Conditions: isKtvSubmitNote=${isKtvSubmitNote}, isManagerConfirmNote=${isManagerConfirmNote}, isManagerDirect=${isManagerDirect}`);

        if (isKtvSubmitNote) {
            console.log("[submitTransaction Mượn] Branch: KTV Submit Note - Setting status: Pending"); // Log nhánh và status
            const selfNoteId = currentTs;
            const pendingNoteRefById = db.collection(PENDING_NOTES_COLLECTION).doc(selfNoteId);
            batch.set(pendingNoteRefById, { timestamp: selfNoteId, type: 'Mượn', email: data.email, date: data.date, note: note, isFulfilled: false, status: 'Pending', createdAt: new Date().toISOString() });
            const historyNoteDoc = { timestamp: selfNoteId, email: data.email, type: 'Mượn', date: data.date, note: note, items: [], status: 'Pending', pendingNoteId: selfNoteId };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(selfNoteId);
            batch.set(historyRef, historyNoteDoc);
            transactionDoc = historyNoteDoc;

        } else if (isManagerConfirmNote) {
            console.log("[submitTransaction Mượn] Branch: Manager Confirm Note - Setting status: Fulfilled"); // Log nhánh và status
            const historyDocIdToUpdate = pendingNoteId;
            const historyRefToUpdate = db.collection(HISTORY_COLLECTION).doc(historyDocIdToUpdate);
            const pendingNoteRef = db.collection(PENDING_NOTES_COLLECTION).doc(pendingNoteId);
            let technicianNote = '';
            try { const pendingDocSnap = await pendingNoteRef.get(); if (pendingDocSnap.exists) { technicianNote = pendingDocSnap.data().note || ''; } } catch (e) { console.error(`Error fetching pending note ${pendingNoteId}:`, e); }
            const finalNote = note || technicianNote;
            const updateData = { items, status: 'Fulfilled', note: finalNote, fulfilledTimestamp: currentTs };
            batch.update(historyRefToUpdate, updateData);
             console.log(`[submitTransaction Mượn] Queued history update for ${historyDocIdToUpdate}`); // Log update history
            await fulfillPendingNote_({ db, email: data.email, tsISO: pendingNoteId, batch });
             transactionDoc = { timestamp: historyDocIdToUpdate, email: data.email, type: 'Mượn', date: data.date, note: updateData.note, items: updateData.items, status: 'Fulfilled', pendingNoteId: pendingNoteId };

        } else if (isManagerDirect) {
            console.log("[submitTransaction Mượn] Branch: Manager Direct Borrow - Setting status: Fulfilled"); // Log nhánh và status
            const directBorrowDoc = { timestamp: currentTs, email: data.email, type: 'Mượn', date: data.date, note: note, items: items, status: 'Fulfilled', pendingNoteId: '' };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(currentTs);
            batch.set(historyRef, directBorrowDoc);
            transactionDoc = directBorrowDoc;
        } else {
             console.error("!!! [submitTransaction Mượn] LỖI LOGIC: Không khớp nhánh nào!");
             throw new Error("Lỗi logic xử lý yêu cầu mượn.");
        }

        await batch.commit();
        console.log("[submitTransaction Mượn] Batch committed.");

        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }

    // --- LOGIC TRẢ (Đã thêm Log và Xóa Lỗi Lặp) ---
    } else if (data.type === 'Trả') {
        console.log("[submitTransaction] Processing 'Trả' transaction...");
        const tickets = data.tickets || [];
        const itemsR = data.items || [];
        const note = data.note || '';
        const currentTs = ts;

        // XÁC ĐỊNH LOGIC MỚI
        const isKtvReconcile = tickets.length > 0;
        const isManagerDirectReturn = data.mode === 'MANAGER_DIRECT' && itemsR.length > 0; // QL Trả Trực tiếp
        const isManagerConfirmNote = !!data.returnTimestamp && itemsR.length > 0; // QL Duyệt Note
        // KTV Gửi Note (Nếu không phải 3 trường hợp kia)
        const isKtvSubmitPendingReturn = !isKtvReconcile && !isManagerConfirmNote && !isManagerDirectReturn && (itemsR.length > 0 || !!note);

        console.log(`[submitTransaction Trả] Conditions: KtvReconcile=${isKtvReconcile}, MngConfirmNote=${isManagerConfirmNote}, KtvSubmitPending=${isKtvSubmitPendingReturn}, MngDirectReturn=${isManagerDirectReturn}`);

        if (isKtvSubmitPendingReturn) {
            // 1. KTV Gửi (Tạo Pending)
            console.log("[submitTransaction Trả] Branch: KTV Submit Pending Return - Setting status: Pending");
            const selfNoteId = currentTs;
            // KTV gửi 'quantityReturned', backend lưu 'quantity'
            const historyItems = (itemsR || []).map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            const pendingNoteRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(selfNoteId);
            batch.set(pendingNoteRef, { timestamp: selfNoteId, type: 'Trả', email: data.email, date: data.date, note: note, items: historyItems, isFulfilled: false, status: 'Pending', createdAt: new Date().toISOString() });
            
            transactionDoc = { timestamp: selfNoteId, email: data.email, type: 'Trả', date: data.date, note: note, items: historyItems, status: 'Pending', pendingNoteId: selfNoteId };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(selfNoteId);
            batch.set(historyRef, transactionDoc);
            
            await batch.commit();

        } else if (isKtvReconcile) {
            // 2. KTV Đối chiếu (ĐÃ SỬA LỖI CHIA LÔ > 30)
            console.log("[submitTransaction Trả] Branch: KTV Reconcile");
            const normEmail = utils.normalizeCode(data.email);
            const allTicketsToUpdate = (tickets || []).map(t => (t || '').toString().trim());
            
            // Chia danh sách vé thành các lô 30 (giới hạn của Firestore)
            const CHUNK_SIZE = 30;
            const ticketChunks = chunkArray(allTicketsToUpdate, CHUNK_SIZE);
            
            let totalUpdated = 0;

            console.log(`[KTV Reconcile] Tổng ${allTicketsToUpdate.length} vé, chia thành ${ticketChunks.length} lô.`);

            // Xử lý từng lô
            for (const ticketChunk of ticketChunks) {
                console.log(`[KTV Reconcile] Đang xử lý lô ${ticketChunk.length} vé...`);
                
                // Tạo một batch MỚI cho mỗi lô
                const chunkBatch = db.batch(); 
                
                // Truy vấn chỉ cho lô này (an toàn <= 30)
                const usageQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('email', '==', normEmail)
                    .where('ticket', 'in', ticketChunk) // <-- An toàn
                    .where('status', '==', 'Chưa đối chiếu')
                    .get();

                if (!usageQuery.empty) {
                    usageQuery.forEach(doc => {
                        chunkBatch.update(doc.ref, { status: 'Đã đối chiếu' });
                    });
                    
                    // Commit batch của lô này
                    await chunkBatch.commit(); 
                    totalUpdated += usageQuery.size;
                }
            } // Kết thúc vòng lặp

            if (totalUpdated === 0) {
                throw new Error("Không tìm thấy số sổ nào hợp lệ để đối chiếu.");
            }

            // Ghi backup vào Sheet (chỉ gọi 1 lần với TẤT CẢ vé)
            updateUsageTicketStatusInSheet_({ sheets, spreadsheetId, tickets: allTicketsToUpdate, email: normEmail });
            
            // Trả về tổng số vé đã cập nhật
            return { ok: true, updated: totalUpdated }; // Kết thúc sớm

        } else if (isManagerConfirmNote) {
            // 3. QL Duyệt note (Tạo Fulfilled, Cập nhật)
            console.log("[submitTransaction Trả] Branch: Manager Confirm Note - Setting status: Fulfilled");
            const historyDocIdToUpdate = data.returnTimestamp;
            const historyRefToUpdate = db.collection(HISTORY_COLLECTION).doc(historyDocIdToUpdate);
            const pendingNoteRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(historyDocIdToUpdate);

            let technicianNote = '';
            try {
                const pendingDocSnap = await pendingNoteRef.get();
                if (pendingDocSnap.exists) technicianNote = pendingDocSnap.data().note || '';
            } catch (e) { console.error(`Error fetching pending return note ${historyDocIdToUpdate}:`, e); }

            const finalNote = note || technicianNote; // Note của KTV (vì QL không nhập note lúc duyệt)
            // QL duyệt 'quantityReturned', backend lưu 'quantity'
            const updateItems = itemsR.map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            const updateData = { items: updateItems, status: 'Fulfilled', note: finalNote, fulfilledTimestamp: currentTs };
            batch.update(historyRefToUpdate, updateData);

            await fulfillPendingReturnNote_({ db, email: data.email, tsISO: historyDocIdToUpdate, batch });

            transactionDoc = { timestamp: historyDocIdToUpdate, email: data.email, type: 'Trả', date: data.date, note: updateData.note, items: updateData.items, status: 'Fulfilled', pendingNoteId: historyDocIdToUpdate };
            await batch.commit();

        } else if (isManagerDirectReturn) {
            // 4. QL TRẢ TRỰC TIẾP (Tạo Fulfilled, Mới)
            console.log("[submitTransaction Trả] Branch: Manager Direct Return - Setting status: Fulfilled");
            // QL trả trực tiếp 'quantityReturned', backend lưu 'quantity'
            const historyItems = (itemsR || []).map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            transactionDoc = { 
                timestamp: currentTs, 
                email: data.email, 
                type: 'Trả', 
                date: data.date,
                note: note, 
                items: historyItems, 
                status: 'Fulfilled',
                pendingNoteId: ''
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(currentTs);
            batch.set(historyRef, transactionDoc);
            await batch.commit();
            
        } else {
             console.error("!!! [submitTransaction Trả] LỖI LOGIC: Không khớp với nhánh nào!");
        }

        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }

    } else {
        console.error("!!! [submitTransaction] LỖI: Loại giao dịch không hợp lệ:", data.type);
         throw new Error("Loại giao dịch không hợp lệ.");
    }

    return true; // Return mặc định
}

// =======================================================
// 4. XỬ LÝ EXCEL (Ghi vào Firestore & Sheets)
// =======================================================
// File: functions/data-processor.js
// THAY THẾ TOÀN BỘ HÀM CŨ BẰNG HÀM NÀY:

/**
 * Lưu dữ liệu Excel đã xử lý vào sheet 'Đối chiếu sổ 3 liên', xử lý trùng lặp.
 * (ĐÃ SỬA LỖI BATCH > 500)
 */
/**
 * Lưu dữ liệu Excel (ĐÃ SỬA LOGIC: Xóa cũ, Thêm mới)
 */
async function saveExcelData({ sheets, spreadsheetId, db, data }) {
    if (!data || data.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ để lưu.');
    }

    let totalNew = 0;
    let totalDeleted = 0;
    const batchSize = 450; // Giữ an toàn (giới hạn là 500)

    // 1. Chia dữ liệu Excel thành các lô 450
    const dataChunks = chunkArray(data, batchSize);

    // 2. Xử lý từng lô một
    for (const chunk of dataChunks) {
        const batch = db.batch();
        let newCountInChunk = 0;

        // 3. Lấy danh sách Sổ (tickets) duy nhất trong lô này
        const ticketsInChunk = [...new Set(chunk.map(r => r.ticket).filter(t => t))];

        // 4. Tìm và XÓA tất cả các vật tư "Chưa đối chiếu" CŨ
        // thuộc về các sổ này.
        if (ticketsInChunk.length > 0) {
            // Chúng ta phải chia truy vấn 'in' thành các lô 30 (giới hạn mới)
            const ticketSubChunks = chunkArray(ticketsInChunk, 30);
            
            for (const subChunk of ticketSubChunks) {
                const deleteQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('ticket', 'in', subChunk)
                    .where('status', '==', 'Chưa đối chiếu')
                    .get();
                
                if (!deleteQuery.empty) {
                    deleteQuery.forEach(doc => {
                        batch.delete(doc.ref);
                        totalDeleted++;
                    });
                }
            }
        }
        
        // 5. Tìm tất cả các vật tư "Đã đối chiếu"
        // (Chúng ta không muốn thêm lại chúng)
        const reconciledItems = new Set();
        if (ticketsInChunk.length > 0) {
             const ticketSubChunks = chunkArray(ticketsInChunk, 30);
             for (const subChunk of ticketSubChunks) {
                const reconciledQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('ticket', 'in', subChunk)
                    .where('status', '==', 'Đã đối chiếu')
                    .get();

                if (!reconciledQuery.empty) {
                    reconciledQuery.docs.forEach(doc => {
                        const key = doc.data().ticket + '|' + doc.data().itemCode;
                        reconciledItems.add(key);
                    });
                }
             }
        }

        // 6. THÊM tất cả vật tư MỚI từ lô Excel
        // (TRỪ những cái đã được đối chiếu)
        chunk.forEach(r => {
            const docData = {
                date: r.date || '',
                itemCode: utils.normalizeCode(r.itemCode || ''),
                itemName: r.itemName || '',
                ticket: r.ticket || '',
                quantity: Number(r.quantity) || 0,
                email: r.email || '',
                note: r.note || '',
                status: 'Chưa đối chiếu' // Luôn đặt là "Chưa đối chiếu"
            };

            // Chỉ thêm nếu Sổ và Mã VT hợp lệ
            if (docData.ticket && docData.itemCode) {
                const key = docData.ticket + '|' + docData.itemCode;
                
                // Nếu vật tư này CHƯA từng được đối chiếu
                if (!reconciledItems.has(key)) {
                    const newRef = db.collection(USAGE_TICKETS_COLLECTION).doc();
                    batch.set(newRef, docData);
                    newCountInChunk++;
                }
                // Nếu đã đối chiếu, chúng ta bỏ qua (không thêm)
            }
        });

        // 7. Commit batch (Xóa + Thêm)
        await batch.commit();
        totalNew += newCountInChunk;
        
        // 8. Ghi backup vào Google Sheets (Chỉ ghi những gì vừa thêm)
        const newDataToBackup = chunk.filter(r => {
             const key = (r.ticket || '') + '|' + utils.normalizeCode(r.itemCode || '');
             return r.ticket && r.itemCode && !reconciledItems.has(key);
        });
        
        if (newDataToBackup.length > 0) {
            writeUsageTicketsToSheet_({ sheets, spreadsheetId, data: newDataToBackup });
        }
    } // Hết vòng lặp (chuyển sang lô tiếp theo)

    return { ok: true, message: `Lưu thành công. Đã xóa ${totalDeleted} vật tư cũ, thêm mới ${totalNew} vật tư.` };
}


// =======================================================
// 5. CÁC HÀM QUẢN LÝ (Helper)
// =======================================================

/**
 * Đánh dấu Pending BORROW Note là Fulfilled
 */
async function fulfillPendingNote_({ db, email, tsISO, batch }) {
    const normEmail = utils.normalizeCode(email);

    // Sửa: Tìm document trong pending_notes bằng ID (chính là tsISO)
    const docRef = db.collection(PENDING_NOTES_COLLECTION).doc(tsISO);

    // Lấy doc để kiểm tra có tồn tại và chưa fulfilled không (tránh ghi đè lỗi)
    const docSnap = await docRef.get(); // Cần await ở đây vì dùng get() ngoài batch

    if (docSnap.exists && docSnap.data().isFulfilled === false && docSnap.data().email === normEmail) {
        // Nếu tồn tại, đúng email, và chưa fulfilled -> Cập nhật bằng batch
        batch.update(docRef, {
            isFulfilled: true,
            status: 'Fulfilled', // Đặt trạng thái là Fulfilled
            fulfilledAt: new Date().toISOString()
        });
        console.log(`[fulfillPendingNote_] Queued update for pending note: ${tsISO}`);
    } else if (!docSnap.exists) {
         console.warn(`[fulfillPendingNote_] Pending note with ID ${tsISO} not found.`);
    } else if (docSnap.data().isFulfilled === true) {
         console.warn(`[fulfillPendingNote_] Pending note ${tsISO} was already fulfilled.`);
    } else if (docSnap.data().email !== normEmail) {
         console.warn(`[fulfillPendingNote_] Email mismatch for pending note ${tsISO}. Expected ${normEmail}, found ${docSnap.data().email}`);
    }
}

/**
 * Đánh dấu Pending RETURN Note là Fulfilled
 */
async function fulfillPendingReturnNote_({ db, email, tsISO, batch }) {
    const normEmail = utils.normalizeCode(email);
    const docRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(tsISO);

    // Vẫn cần đọc trước batch để kiểm tra
    const docSnap = await docRef.get();

    if (docSnap.exists && docSnap.data().isFulfilled === false && docSnap.data().email === normEmail) {
        batch.update(docRef, {
            isFulfilled: true,
            status: 'Fulfilled',
            fulfilledAt: new Date().toISOString()
        });
        console.log(`[fulfillPendingReturnNote_] Queued update for pending return note: ${tsISO} to Fulfilled.`); // Log hành động
    } else {
         if (!docSnap.exists) { console.warn(`[fulfillPendingReturnNote_] Not updating: Pending return note ${tsISO} not found.`); }
         else if (docSnap.data().isFulfilled === true) { console.warn(`[fulfillPendingReturnNote_] Not updating: Pending return note ${tsISO} already fulfilled.`); }
         else if (docSnap.data().email !== normEmail) { console.warn(`[fulfillPendingReturnNote_] Not updating: Email mismatch for pending return note ${tsISO}.`); }
         else { console.warn(`[fulfillPendingReturnNote_] Not updating note ${tsISO} for unknown reason.`); } // Log trường hợp khác
    }
}

/**
 * Từ chối Pending BORROW Note (VÀ cập nhật history)
 */
async function rejectPendingBorrowNote_({ db, email, tsISO, reason }) {
    const normEmail = utils.normalizeCode(email);
    const batch = db.batch();

    // 1. Cập nhật PENDING_NOTES_COLLECTION
    const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .where('isFulfilled', '==', false)
        .limit(1)
        .get();

    if (pendingSnapshot.empty) {
         throw new Error('Không tìm thấy note mượn hàng đang chờ.');
    }
    
    const pendingDocRef = pendingSnapshot.docs[0].ref;
    batch.update(pendingDocRef, {
        isFulfilled: true,
        status: 'Rejected',
        rejectionReason: reason,
        fulfilledAt: new Date().toISOString()
    });

    // 2. Cập nhật HISTORY_COLLECTION
    const historySnapshot = await db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) // Hoặc dùng pendingNoteId
        .limit(1)
        .get();
        
    if (!historySnapshot.empty) {
        const historyDocRef = historySnapshot.docs[0].ref;
        batch.update(historyDocRef, {
            status: 'Rejected',
            rejectionReason: reason
        });
    }
    
    await batch.commit();
    return true;
}

/**
 * Từ chối Pending RETURN Note (VÀ cập nhật history)
 */
async function rejectPendingReturnNote_({ db, email, tsISO, reason }) {
    const normEmail = utils.normalizeCode(email);
    const batch = db.batch();

    // 1. Cập nhật PENDING_RETURN_NOTES_COLLECTION
    const pendingSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .where('isFulfilled', '==', false)
        .limit(1)
        .get();

    if (pendingSnapshot.empty) {
         throw new Error('Không tìm thấy note trả hàng đang chờ.');
    }
    
    const pendingDocRef = pendingSnapshot.docs[0].ref;
    batch.update(pendingDocRef, {
        isFulfilled: true,
        status: 'Rejected',
        rejectionReason: reason,
        fulfilledAt: new Date().toISOString()
    });

    // 2. Cập nhật HISTORY_COLLECTION
    const historySnapshot = await db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .limit(1)
        .get();
        
    if (!historySnapshot.empty) {
        const historyDocRef = historySnapshot.docs[0].ref;
        batch.update(historyDocRef, {
            status: 'Rejected',
            rejectionReason: reason
        });
    }
    
    await batch.commit();
    return true;
}

// =======================================================
// 6. CÁC HÀM CÒN LẠI (Ít thay đổi)
// =======================================================

// Đọc từ Sheet (Vì ít thay đổi)
// Đọc từ Firestore (Không cần 'sheets' hay 'spreadsheetId' nữa)
async function getTechnicians({ db }) {
    console.log("[Firestore] Đang tải danh sách KTV từ collection 'technicians'...");

    // Sắp xếp theo tên để hiển thị dropdown theo thứ tự ABC
    const techSnapshot = await db.collection('technicians').orderBy('name').get();

    if (techSnapshot.empty) {
        console.warn("Không tìm thấy KTV nào trong collection 'technicians'.");
        return [];
    }

    const techList = [];
    techSnapshot.forEach(doc => {
        techList.push(doc.data()); // .data() sẽ là { email: "...", name: "..." }
    });

    return techList;
}

// Đọc từ Sheet (Vì ít thay đổi)
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

// Đọc từ Sheet
async function getTicketRanges({ sheets, spreadsheetId, email }) {
    const { ticketRangesMap } = await getCoreSheetData({ sheets, spreadsheetId });
    const normEmail = utils.normalizeCode(email);
    
    return ticketRangesMap
        .filter(r => r.email === normEmail)
        .map(r => ({ start: r.start, end: r.end }))
        .sort((a, b) => a.start - b.start);
}

// Ghi vào Sheet (Phức tạp, giữ nguyên)
// File: functions/data-processor.js
// THAY THẾ TOÀN BỘ HÀM CŨ BẰNG HÀM NÀY:

async function saveTicketRanges({ sheets, spreadsheetId, email, ranges }) {
    const sheetName = 'TicketRanges'; // Tên Sheet
    const normEmail = utils.normalizeCode(email);
    const newTimestamp = new Date().toISOString();

    try {
        // 1. ĐỌC TẤT CẢ DỮ LIỆU CŨ (trừ header)
        const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:E`, // Đọc 5 cột A-E, từ dòng 2
        });
        const allValues = readResult.data.values || [];

        // 2. LỌC: Giữ lại tất cả dải số KHÔNG thuộc về KTV này
        const otherUserRows = allValues.filter(row => {
            const rowEmail = utils.normalizeCode(row[0] || '');
            return rowEmail && rowEmail !== normEmail;
        });

        // 3. TẠO: Tạo các hàng mới cho KTV này (từ mảng 'ranges' đã sửa)
        const currentUserRows = (ranges || []).map(r => [
            email, 
            r.start, 
            r.end, 
            newTimestamp, // Ngày tạo
            newTimestamp  // Ngày cập nhật
        ]);

        // 4. GỘP LẠI: Dữ liệu của người khác + Dữ liệu mới của KTV này
        const finalData = [
            ...otherUserRows,
            ...currentUserRows
        ];

        // 5. XÓA SẠCH DỮ LIỆU CŨ (từ A2 trở đi)
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A2:E`, // Xóa sạch từ dòng 2
        });

        // 6. GHI LẠI DỮ LIỆU MỚI (chỉ ghi nếu có)
        if (finalData.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A2`, // Ghi đè bắt đầu từ A2
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: finalData
                },
            });
        }

        return { ok: true, message: `Lưu ${currentUserRows.length} dải số thành công.` };

    } catch (err) {
        console.error("Lỗi nghiêm trọng khi saveTicketRanges:", err);
        throw new Error("Lỗi khi cập nhật Google Sheet: " + err.message);
    }
}

// Ghi vào Sheet
async function submitErrorReport({ sheets, spreadsheetId, data }) {
    const rows = [[
        new Date().toISOString(), data.email || '', data.errorType || '',
        data.description || '', data.relatedTicketOrDate || '', data.suggestedFix || ''
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Báo cáo sai sót!A:F', 
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: rows },
    });
    return true;
}

// Dùng Sheet (readCoreSheetData)
async function processExcelData({ sheets, spreadsheetId, data }) {
    const { ticketRangesMap } = await getCoreSheetData({ sheets, spreadsheetId });
    // Logic xử lý (normalize) của bạn ở đây là đúng, giữ nguyên
    const processed = (data || []).map(row => {
        let parsedDate = row.date;
        if (typeof parsedDate === 'number') {
            const dateObj = new Date((parsedDate - 25569) * 86400 * 1000);
            if (!isNaN(dateObj.getTime())) {
                parsedDate = utils.fmtDate(dateObj);
            }
        }
        let ticket = (row.ticket == null) ? '' : String(row.ticket);
        if (ticket && !/^Sổ\s+/i.test(ticket)) ticket = 'Sổ ' + ticket.replace(/^Sổ\s*/i, '').trim();
        let email = row.email || '';
        const numMatch = ticket.match(/\d+/);
        if (!email && numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (isFinite(num)) {
                email = utils.getEmailByTicketNumber(num, ticketRangesMap);
            }
        }
        return {
            date: parsedDate || row.date || '',
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


// Ghi KTV mới vào Firestore
async function verifyAndRegisterUser({ db, email, name }) {
    const normEmail = utils.normalizeCode(email);

    // Dùng email làm Document ID
    const techRef = db.collection('technicians').doc(normEmail);

    const doc = await techRef.get();

    if (!doc.exists) {
        // Nếu KTV chưa tồn tại, thêm họ vào
        await techRef.set({
            email: email,
            name: name || email, // Nếu họ không có tên, dùng email
            createdAt: new Date().toISOString()
        });
        console.log(`[Firestore] Đã đăng ký KTV mới: ${email}`);
    }

    // Hàm này không còn check role nữa, vì Custom Claims đã làm việc đó.
    // Chỉ cần trả về thông tin cơ bản.
    return { email, name };
}

// Dùng Firestore (Đã refactor ở trên)
async function rejectReturnNote({ db, data }) {
    return rejectPendingReturnNote_({
        db, 
        email: data.email,
        tsISO: data.timestamp,
        reason: data.reason
    });
}

// Dùng Firestore (Đã refactor ở trên)
async function rejectBorrowNote({ db, data }) {
    return rejectPendingBorrowNote_({
        db, 
        email: data.email,
        tsISO: data.timestamp,
        reason: data.reason
    });
}

// Dùng Firestore (Đã có, giữ nguyên)
async function getPendingCounts({ db }) {
    let pendingBorrowEmails = [];
    let pendingReturnEmails = [];
    try {
        const borrowSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        const borrowEmailsSet = new Set();
        borrowSnapshot.forEach(doc => doc.data().email && borrowEmailsSet.add(doc.data().email));
        pendingBorrowEmails = Array.from(borrowEmailsSet);

        const returnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        const returnEmailsSet = new Set();
        returnSnapshot.forEach(doc => doc.data().email && returnEmailsSet.add(doc.data().email));
        pendingReturnEmails = Array.from(returnEmailsSet);

        return { pendingBorrowEmails, pendingReturnEmails };
    } catch (error) {
        console.error("Error getting pending counts/emails:", error);
        return { pendingBorrowEmails: [], pendingReturnEmails: [] };
    }
}

// File: functions/data-processor.js
// THAY THẾ TOÀN BỘ HÀM NÀY:

async function managerTransferItems({ sheets, spreadsheetId, db, data }) {
    const { fromEmail, toEmail, date, items } = data;

    if (!fromEmail || !toEmail || !date || !items || items.length === 0) {
        throw new Error('Thiếu thông tin người chuyển, người nhận, ngày hoặc vật tư.');
    }
    if (fromEmail === toEmail) {
        throw new Error('Người chuyển và người nhận phải khác nhau.');
    }

    // === BẮT ĐẦU SỬA CHỮA: LẤY TÊN KTV ===
    
    // 1. Lấy tên KTV từ Sheet 'Danh sách kỹ thuật viên'
    let fromName = fromEmail;
    let toName = toEmail;
    try {
        const techResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Danh sách kỹ thuật viên!A2:B', // Đọc cột Email(A) và Tên(B)
        });
        const techs = techResponse.data.values || [];
        
        // Dùng Map để tra cứu tên nhanh
        const techMap = new Map(techs.map(row => [utils.normalizeCode(row[0]), row[1] || row[0]]));
        
        // Lấy tên, nếu không thấy thì dùng email làm dự phòng
        fromName = techMap.get(utils.normalizeCode(fromEmail)) || fromEmail;
        toName = techMap.get(utils.normalizeCode(toEmail)) || toEmail;
        
    } catch (sheetError) {
         // Nếu đọc Sheet lỗi (ví dụ: rate limit), dùng email làm dự phòng
         console.warn("Không thể lấy tên KTV từ Sheet, sẽ dùng Email:", sheetError.message);
    }
    // === KẾT THÚC SỬA CHỮA ===

    const timestamp = new Date().toISOString();
    const batch = db.batch();

    // 2. Tạo doc "Trả" cho người chuyển
    const returnTx = {
        timestamp: timestamp, 
        email: fromEmail, 
        type: 'Trả', 
        date: date,
        note: `Chuyển cho ${toName}`, // <-- Sẽ dùng TÊN
        items: items, 
        status: 'Fulfilled',
        pendingNoteId: ''
    };
    const returnRef = db.collection(HISTORY_COLLECTION).doc(); // Tự tạo ID
    batch.set(returnRef, returnTx);
    
    // 3. Tạo doc "Mượn" cho người nhận
    const borrowTx = {
        timestamp: timestamp, 
        email: toEmail, 
        type: 'Mượn', 
        date: date,
        note: `Nhận từ ${fromName}`, // <-- Sẽ dùng TÊN
        items: items, 
        status: 'Fulfilled',
        pendingNoteId: ''
    };
    const borrowRef = db.collection(HISTORY_COLLECTION).doc(); // Tự tạo ID
    batch.set(borrowRef, borrowTx);

    // 4. Ghi vào Firestore
    await batch.commit();

    // 5. Ghi backup vào Sheets (Async)
    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: returnTx });
    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: borrowTx });

    return { ok: true, message: 'Chuyển vật tư thành công.' };
}
/**
 * [MỚI] Gọi API Google TTS để tạo âm thanh từ văn bản
 */
/**
 * [MỚI] Gọi API ZaloTTS để tạo âm thanh từ văn bản
 */
async function getSpeechAudio({ text }) {
    // Lấy API key đã lưu ở Bước 1
    const ZALO_API_KEY = process.env.ZALO_API_KEY; 
    if (!ZALO_API_KEY) {
        console.error("!!! ZALO_API_KEY chưa được thiết lập trong Biến môi trường.");
        throw new Error('ZALO_API_KEY is not set in environment variables.');
    }

    console.log(`[ZaloTTS] Đang yêu cầu âm thanh cho: "${text}"`);

    // Chuẩn bị dữ liệu gửi đi (dạng form-urlencoded)
    const params = new URLSearchParams();
    params.append('input', text); //[cite: 4]

    // === CHỌN GIỌNG MIỀN NAM ===
    // 1 = Nữ miền Nam 1
    // 3 = Nam miền Nam
    // 6 = Nữ miền Nam 2
    params.append('speaker_id', '6'); // <-- Chọn giọng Nam miền Nam [cite: 6]

    // params.append('speed', '1.0'); // Tùy chọn tốc độ [cite: 5]
    params.append('encode_type', '1'); // 1 = MP3 [cite: 6]

    try {
        // Gọi API Zalo
        const response = await fetch('https://api.zalo.ai/v1/tts/synthesize', { // [cite: 4]
            method: 'POST',
            headers: {
              'apikey': ZALO_API_KEY, // [cite: 4]
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const result = await response.json();

        // Kiểm tra lỗi từ Zalo 
        if (result.error_code !== 0) {
            console.error("Lỗi ZaloTTS API:", result);
            throw new Error(`ZaloTTS Error ${result.error_code}: ${result.error_message}`);
        }

        // Trả về URL cho frontend 
        console.log("[ZaloTTS] Tạo âm thanh thành công, trả về URL.");
        return { audioUrl: result.data.url };

    } catch (err) {
        console.error("LỖI gọi ZaloTTS API:", err);
        throw new Error("Không thể tạo âm thanh từ ZaloTTS API.");
    }
}
/**
 * [MỚI] Lấy tổng quan tồn kho TẤT CẢ KTV
 */
/**
 * [SỬA LỖI] Lấy tổng quan tồn kho TẤT CẢ KTV
 * (Chỉ tính sổ 3 liên CÓ EMAIL)
 */
/**
 * [NÂNG CẤP] Lấy tổng quan tồn kho TẤT CẢ KTV, có chi tiết nợ theo Email
 */
async function getGlobalInventoryOverview({ sheets, spreadsheetId, db }) {
    console.log("[Firestore Global] Đang tải tổng quan TOÀN HỆ THỐNG (Có chi tiết Email)...");

    const { itemCodeMap } = await getCoreSheetData({ sheets, spreadsheetId });

    // Cấu trúc mới: { "VT001": { "ktv1@email.com": { borrowed: 10, used: 5, returned: 0 }, "ktv2@email.com": { ... } } }
    const byCodeAndEmail = {}; 

    // 1. Quét TOÀN BỘ lịch sử mượn/trả
    try {
        const historySnapshot = await db.collection(HISTORY_COLLECTION).get();

        historySnapshot.forEach(doc => {
            const data = doc.data();
            const items = data.items || [];
            const email = data.email || '';

            if (!email) return; // Bỏ qua giao dịch không có email

            items.forEach(item => {
                if (!item || !item.code) return; 
                const code = utils.normalizeCode(item.code);

                // Khởi tạo
                if (!byCodeAndEmail[code]) byCodeAndEmail[code] = {};
                if (!byCodeAndEmail[code][email]) {
                    byCodeAndEmail[code][email] = { 
                        name: item.name || itemCodeMap.get(code) || code, 
                        totalBorrowed: 0, 
                        totalUsed: 0, 
                        totalReturned: 0 
                    };
                }

                const itemQuantity = Number(item.quantity) || 0;
                if (data.type === 'Mượn') {
                    byCodeAndEmail[code][email].totalBorrowed += itemQuantity;
                } else if (data.type === 'Trả' && data.status === 'Fulfilled') {
                    byCodeAndEmail[code][email].totalReturned += itemQuantity;
                }
            });
        });
    } catch (e) {
         console.error("Lỗi đọc Global HISTORY_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu lịch sử toàn hệ thống.");
    }

    // 2. Quét TOÀN BỘ sổ đã sử dụng
    try {
        const usageSnapshot = await db.collection(USAGE_TICKETS_COLLECTION).get();

        usageSnapshot.forEach(doc => {
            const data = doc.data();
            const itemCode = utils.normalizeCode(data.itemCode);
            const quantityUsed = Number(data.quantity) || 0;
            const email = data.email || '';

            // Bỏ qua nếu không có mã VT, SL, hoặc EMAIL
            if (!itemCode || quantityUsed <= 0 || !email) { 
                return; 
            }

            if (data.status === 'Chưa đối chiếu' || data.status === 'Đã đối chiếu') {
                // Khởi tạo
                if (!byCodeAndEmail[itemCode]) byCodeAndEmail[itemCode] = {};
                if (!byCodeAndEmail[itemCode][email]) {
                     byCodeAndEmail[itemCode][email] = { 
                         name: data.itemName || itemCodeMap.get(itemCode) || itemCode, 
                         totalBorrowed: 0, totalUsed: 0, totalReturned: 0 
                     };
                }
                // Cộng vào totalUsed
                byCodeAndEmail[itemCode][email].totalUsed += quantityUsed;
            }
        });
    } catch (e) {
         console.error("Lỗi đọc Global USAGE_TICKETS_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu đối chiếu toàn hệ thống.");
    }

    // 3. Tính toán và trả về
    const overviewList = [];

    // Lặp qua từng Item Code (Vd: "VT001")
    for (const code in byCodeAndEmail) {
        const emails = byCodeAndEmail[code];
        let totalBorrowed = 0;
        let totalUsed = 0;
        let totalReturned = 0;
        const debtors = []; // Mảng chứa các KTV đang nợ

        // Lặp qua từng Email trong Item Code đó (Vd: "ktv.a@email.com")
        for (const email in emails) {
            const data = emails[email];
            const remaining = (data.totalBorrowed - data.totalReturned) - data.totalUsed;

            // Tính tổng chung
            totalBorrowed += data.totalBorrowed;
            totalUsed += data.totalUsed;
            totalReturned += data.totalReturned;

            // Nếu KTV này có nợ (âm hoặc dương)
            if (remaining !== 0) {
                debtors.push({
                    email: email,
                    remaining: remaining
                });
            }
        }

        const totalRemaining = (totalBorrowed - totalReturned) - totalUsed;

        // Theo yêu cầu của bạn: Chỉ hiển thị nếu TỔNG nợ khác 0
        if (totalRemaining !== 0) {
            overviewList.push({
                code: code,
                name: emails[Object.keys(emails)[0]].name, // Lấy tên từ KTV đầu tiên
                totalBorrowed: totalBorrowed,
                totalUsed: totalUsed,
                totalReturned: totalReturned,
                remaining: totalRemaining, // Tổng nợ
                debtors: debtors // Danh sách KTV đang nợ
            });
        }
    } // Hết vòng lặp for (code in byCodeAndEmail)

    console.log(`[Firestore Global] Tổng hợp xong ${overviewList.length} vật tư.`);

    // Sắp xếp theo Tên vật tư
    overviewList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return overviewList;
}
/**
 * [MỚI] Tạo một giao dịch Mượn (Điều chỉnh) để bù kho bị âm
 */
async function fixNegativeInventory({ sheets, spreadsheetId, db, email, itemCode, itemName, amountToFix }) {
    console.log(`[Fix Kho] Đang điều chỉnh ${amountToFix} cho ${itemCode} của KTV ${email}`);

    const timestamp = new Date().toISOString();
    const date = new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

    const adjustmentTx = {
        timestamp: timestamp,
        email: email,
        type: 'Mượn',
        date: date,
        note: `Điều chỉnh kho âm (Tự động)`,
        items: [{
            code: itemCode,
            name: itemName,
            quantity: Number(amountToFix) || 0
        }],
        status: 'Fulfilled', // Tự động duyệt
        pendingNoteId: '',
        mode: 'ADJUSTMENT' // Chế độ mới: Điều chỉnh
    };

    // 1. Ghi vào Firestore
    const historyRef = db.collection(HISTORY_COLLECTION).doc(timestamp);
    await historyRef.set(adjustmentTx);

    // 2. Ghi Backup vào Sheet (chạy ngầm)
    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: adjustmentTx });

    return { ok: true, message: 'Điều chỉnh kho thành công.' };
}

/**
 * [MỚI] Sửa hàng loạt kho âm (tạo nhiều giao dịch điều chỉnh)
 */
async function fixNegativeInventoryBatch({ sheets, spreadsheetId, db, email, itemsToFix }) {
    console.log(`[Fix Kho Batch] Đang điều chỉnh ${itemsToFix.length} vật tư âm cho ${email}`);

    // Dùng Batch để ghi tất cả giao dịch 1 lần
    const batch = db.batch();
    const timestampBase = new Date().getTime(); // Dùng 1 mốc thời gian
    const date = new Date(timestampBase).toLocaleString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

    for (let i = 0; i < itemsToFix.length; i++) {
        const item = itemsToFix[i];

        // Lấy số lượng cần bù (chuyển số âm thành dương)
        const amountToFix = Math.abs(Number(item.remaining) || 0);

        // Bỏ qua nếu item không hợp lệ (ví dụ: số nợ = 0)
        if (amountToFix === 0) continue; 

        // Tạo một timestamp duy nhất cho mỗi doc (tránh trùng ID)
        const docTimestamp = new Date(timestampBase + i).toISOString(); 

        const adjustmentTx = {
            timestamp: docTimestamp,
            email: email,
            type: 'Mượn',
            date: date,
            note: `Điều chỉnh kho âm (Tự động)`,
            items: [{
                code: item.code,
                name: item.name,
                quantity: amountToFix // Số lượng mượn ảo (số dương)
            }],
            status: 'Fulfilled',
            mode: 'ADJUSTMENT'
        };

        const historyRef = db.collection(HISTORY_COLLECTION).doc(docTimestamp);
        batch.set(historyRef, adjustmentTx);

        // Ghi backup vào Sheet (chạy ngầm, không cần await)
        writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: adjustmentTx });
    }

    // Ghi toàn bộ batch vào Firestore
    await batch.commit(); 

    return { ok: true, message: `Điều chỉnh kho thành công cho ${itemsToFix.length} vật tư.` };
}
/**
 * [REPAIR] Tạo phiếu sửa chữa mới & Sinh mã tự động
 */
async function createRepairTicket({ db, data }) {
    const { creatorEmail, creatorName, customer, device, status, photos } = data;
    
    // 1. Sinh mã phiếu (SC25-xxxx)
    // Dùng Transaction để đảm bảo không bị trùng mã khi nhiều người tạo cùng lúc
    const counterRef = db.collection('counters').doc('repair_tickets');
    
    const ticketId = await db.runTransaction(async (t) => {
        const doc = await t.get(counterRef);
        let newCount = 1;
        if (doc.exists) {
            newCount = doc.data().current + 1;
        }
        
        // Format mã: SC25-0001, SC25-0002...
        const year = new Date().getFullYear().toString().substr(-2); // "25"
        const idStr = newCount.toString().padStart(4, '0');
        const fullId = `SC${year}-${idStr}`;
        
        // Cập nhật counter
        t.set(counterRef, { current: newCount }, { merge: true });
        
        return fullId;
    });

    // 2. Chuẩn bị dữ liệu phiếu
    const ticketDoc = {
        ticketId: ticketId,
        createdAt: new Date().toISOString(),
        createdBy: creatorEmail,
        creatorName: creatorName || creatorEmail,
        // Thông tin khách
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        
        // Thông tin máy
        deviceType: device.type,
        deviceBrand: device.brand,
        deviceModel: device.model,
        deviceSerial: device.serial,
        accessories: device.accessories,
        
        // Trạng thái & Lỗi
        currentStatus: 'Mới nhận', // Status rút gọn để query nhanh
        issueDescription: status.description,
        physicalCondition: status.physicalCondition,
        
        // Hình ảnh (Mảng URL)
        receivePhotos: photos || [],
        
        // Khởi tạo các object rỗng cho các bước sau
        techCheck: null,
        quotation: null,
        repair: null,
        payment: null,
        
        // Search keywords (để tìm kiếm dễ hơn)
        searchKeywords: [
            ticketId.toLowerCase(), 
            customer.phone, 
            utils.normalizeCode(customer.name)
        ]
    };

    // 3. Lưu phiếu vào Firestore
    await db.collection('repair_tickets').doc(ticketId).set(ticketDoc);

    // 4. Ghi log lịch sử thao tác
    await db.collection('repair_logs').add({
        ticketId: ticketId,
        timestamp: new Date().toISOString(),
        user: creatorName,
        action: 'Tạo phiếu tiếp nhận',
        details: `Đã nhận máy. Lỗi: ${status.description}`
    });

    return { ok: true, ticketId: ticketId };
}
/**
 * [REPAIR] Lấy danh sách phiếu sửa chữa (có phân trang & lọc)
 */

/**
 * [REPAIR] Lấy danh sách phiếu sửa chữa (có giới hạn 50 phiếu mới nhất)
 */
/**
 * [REPAIR] Lấy danh sách phiếu sửa chữa (có phân trang & lọc)
 */
async function getRepairTickets({ db, status = '', search = '', lastTicketId = null }) {
    let query = db.collection('repair_tickets').orderBy('createdAt', 'desc');

    // Danh sách các trạng thái được coi là "Chưa hoàn tất"
    const INCOMPLETE_STATUSES = [
        'Mới nhận', 
        'Đang kiểm tra', 
        'Chờ báo giá', 
        'Chờ khách xác nhận', 
        'Đang sửa', 
        'Chờ trả máy', 
        'Trả máy không sửa'
    ];

    // 1. Xử lý Lọc theo trạng thái
    if (status === 'Hoàn tất') {
        // Chỉ lấy phiếu đã xong
        query = query.where('currentStatus', '==', 'Hoàn tất');
        
    } else if (status === 'Chưa hoàn tất') {
        // Lấy tất cả phiếu đang xử lý (dùng toán tử 'in')
        // Lưu ý: Firestore cho phép tối đa 10 giá trị trong mảng 'in'
        query = query.where('currentStatus', 'in', INCOMPLETE_STATUSES);
        
    } else if (status && status !== 'Tất cả' && status !== '') {
        // (Dự phòng) Nếu sau này muốn lọc riêng từng trạng thái cụ thể
        query = query.where('currentStatus', '==', status);
    }

    // 2. Xử lý Tìm kiếm (Search)
    // (Logic tìm kiếm giữ nguyên: Lấy 50 phiếu rồi lọc tay vì Firestore hạn chế)
    if (search) {
        const snapshot = await query.limit(50).get();
        let tickets = snapshot.docs.map(doc => doc.data());
        const searchLower = search.toLowerCase();
        
        return tickets.filter(t => 
            (t.ticketId && t.ticketId.toLowerCase().includes(searchLower)) ||
            (t.customerName && t.customerName.toLowerCase().includes(searchLower)) ||
            (t.customerPhone && t.customerPhone.includes(search)) ||
            (t.deviceSerial && t.deviceSerial.toLowerCase().includes(searchLower))
        );
    }

    // 3. Phân trang (Pagination)
    if (lastTicketId) {
        const lastDocSnap = await db.collection('repair_tickets').doc(lastTicketId).get();
        if (lastDocSnap.exists) {
            query = query.startAfter(lastDocSnap);
        }
    }

    const snapshot = await query.limit(20).get();
    return snapshot.docs.map(doc => doc.data());
}
/**
 * [REPAIR] Lấy chi tiết một phiếu sửa chữa
 */
async function getRepairTicket({ db, ticketId }) {
    if (!ticketId) throw new Error("Thiếu mã phiếu.");
    
    const doc = await db.collection('repair_tickets').doc(ticketId).get();
    if (!doc.exists) {
        throw new Error(`Không tìm thấy phiếu có mã: ${ticketId}`);
    }
    
    return doc.data();
}
/**
 * [REPAIR] Cập nhật thông tin phiếu (Dùng chung cho các bước)
 */
async function updateRepairTicket({ db, ticketId, action, data, userEmail, userName, userRoles }) { // <--- Nhận thêm userRoles
    const ticketRef = db.collection('repair_tickets').doc(ticketId);
    const ticketSnap = await ticketRef.get();
    
    if (!ticketSnap.exists) throw new Error("Phiếu không tồn tại");
    
    const currentTicket = ticketSnap.data();
    
    // 1. KIỂM TRA KHÓA TRẠNG THÁI (Nếu đã xong thì cấm sửa cái cũ)
    const isFinished = currentTicket.currentStatus === 'Hoàn tất' || currentTicket.currentStatus === 'Đã trả máy';
    
    // Nếu phiếu đã hoàn tất, chỉ Admin mới được phép can thiệp (hoặc cấm luôn tùy bạn)
    if (isFinished && !userRoles.admin) {
        // Cấm sửa Kiểm tra hoặc Báo giá khi đã xong
        if (action === 'TECH_CHECK' || action === 'SALE_QUOTE') {
            throw new Error("Phiếu đã hoàn tất. Không thể chỉnh sửa thông tin cũ.");
        }
    }

    // 2. KIỂM TRA QUYỀN KINH DOANH (SALE)
    if (action === 'SALE_QUOTE') {
        // Chỉ Admin hoặc Sale mới được báo giá
        if (!userRoles.admin && !userRoles.sale) {
            throw new Error("Chỉ Phòng Kinh Doanh mới có quyền cập nhật báo giá.");
        }
    }

    let updateData = {};
    let logAction = '';
    let logDetails = '';

    // === XỬ LÝ THEO TỪNG HÀNH ĐỘNG ===
    
    if (action === 'TECH_CHECK') {
        // KTV gửi kết quả kiểm tra
        updateData = {
            currentStatus: 'Chờ báo giá', // Chuyển trạng thái
            techCheck: {
                technicianName: userName,
                technicianEmail: userEmail,
                checkDate: new Date().toISOString(),
                cause: data.cause, // Nguyên nhân
                solution: data.solution, // Đề xuất xử lý
                components: data.components, // Linh kiện cần thay
                photos: data.photos || []
            }
        };
        logAction = 'Kỹ thuật kiểm tra';
        logDetails = `Kết luận: ${data.cause}`;
    }
    
    else if (action === 'SALE_QUOTE') {
        // Sale báo giá
        updateData = {
            currentStatus: 'Chờ khách xác nhận',
            quotation: {
                saleName: userName,
                saleEmail: userEmail,
                quoteDate: new Date().toISOString(),
                
                // === CẬP NHẬT DÒNG NÀY ===
                items: data.items || [], // Danh sách chi tiết linh kiện
                totalPrice: Number(data.totalPrice) || 0, // Tổng tiền tính toán được
                // ========================
                
                warranty: data.warranty,
                notes: data.notes,
                type: data.quoteType || 'INTERNAL', // INTERNAL hoặc EXTERNAL
                externalInfo: data.externalInfo || null // Chứa giá vốn
            }
        };
        logAction = 'Sale báo giá';
        const formattedPrice = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(updateData.quotation.totalPrice);
        logDetails = `Báo giá: ${formattedPrice} (${(data.items || []).length} hạng mục)`;
    }
    else if (action === 'CUSTOMER_CONFIRM') {
        const isAgreed = data.isAgreed; // true (Đồng ý) / false (Không sửa)
        
        // Kiểm tra xem KTV có kết luận "Không sửa được" không
        const techSolution = currentTicket.techCheck ? currentTicket.techCheck.solution : '';
        const isUnrepairable = techSolution === 'Không sửa được' || techSolution === 'Trả máy (Không sửa được)';

        // LOGIC CHUYỂN TRẠNG THÁI:
        // 1. Khách ĐỒNG Ý + Máy SỬA ĐƯỢC -> Chuyển sang "Đang sửa"
        // 2. Khách KHÔNG ĐỒNG Ý -> Chuyển sang "Chờ trả máy" (Kết thúc sớm)
        // 3. Khách ĐỒNG Ý (nhận lại) + Máy KHÔNG SỬA ĐƯỢC -> Chuyển sang "Chờ trả máy"

        if (isAgreed && !isUnrepairable) {
            // --- TRƯỜNG HỢP 1: TIẾN HÀNH SỬA ---
            updateData = {
                currentStatus: 'Đang sửa',
                customerConfirm: {
                    date: new Date().toISOString(),
                    result: 'Đồng ý sửa',
                    note: data.note
                }
            };
            logAction = 'Khách xác nhận';
            logDetails = 'Khách ĐỒNG Ý sửa chữa.';
        } else {
            // --- TRƯỜNG HỢP 2 & 3: TRẢ MÁY (KHÔNG SỬA) ---
            let resultText = !isAgreed ? 'Không sửa (Từ chối báo giá)' : 'Đồng ý nhận lại máy (Không sửa được)';
            let workText = !isAgreed ? 'Khách từ chối sửa. Trả nguyên trạng.' : 'Kỹ thuật không sửa được. Trả nguyên trạng.';

            updateData = {
                currentStatus: 'Chờ trả máy', // Thống nhất dùng trạng thái này để hiện nút Trả
                customerConfirm: {
                    date: new Date().toISOString(),
                    result: resultText,
                    note: data.note
                },
                // Tự động tạo dữ liệu "Sửa xong" (giả) để quy trình liền mạch
                repair: {
                    technicianName: userName, // Người xác nhận (Sale/Admin)
                    technicianEmail: userEmail,
                    completionDate: new Date().toISOString(),
                    workDescription: workText,
                    warranty: "Không",
                    photos: [] 
                }
            };
            logAction = 'Khách xác nhận';
            logDetails = `${resultText}. Chuyển sang chờ trả máy.`;
        }
    }
    else if (action === 'EXTERNAL_ACTION') {
        const subType = data.subType; // 'SEND', 'RECEIVE_PASS'

        if (subType === 'SEND') {
            // 1. Xác nhận đã gửi máy đi
            updateData = {
                currentStatus: 'Đang sửa ngoài', 
                externalLogistics: {
                    sentDate: new Date().toISOString(),
                    sentBy: userName,
                    unitName: data.unitName, // Tên đơn vị sửa
                    note: data.note
                }
            };
            logAction = 'Gửi sửa ngoài';
            logDetails = `Đã gửi cho: ${data.unitName}`;
        } 
        else if (subType === 'RECEIVE_PASS') {
            // 2. Nhận máy về & Test OK -> Chuyển sang Chờ trả máy
            updateData = {
                currentStatus: 'Chờ trả máy',
                externalLogistics: {
                    // Giữ lại thông tin lúc gửi
                    ...currentTicket.externalLogistics, 
                    receivedDate: new Date().toISOString(),
                    receivedBy: userName,
                    qcResult: 'Đạt',
                    qcNote: data.note
                },
                // Tự động điền thông tin repair để khớp với quy trình chung
                repair: {
                    technicianName: data.unitName + " (Sửa ngoài)",
                    completionDate: new Date().toISOString(),
                    workDescription: "Sửa chữa bởi đơn vị ngoài. Đã QC: " + data.note,
                    warranty: currentTicket.quotation ? currentTicket.quotation.warranty : 'Theo báo giá'
                }
            };
            logAction = 'Nhận máy & QC Đạt';
            logDetails = 'Đã nhận về. KTV kiểm tra hoạt động tốt.';
        }
    }
    else if (action === 'ORDER_PARTS') {
        // Chuyển sang trạng thái chờ hàng
        updateData = {
            currentStatus: 'Chờ đặt hàng',
            partOrder: {
                orderBy: userName,
                orderDate: new Date().toISOString(),
                note: data.note // Ghi chú đặt hàng (Mã, NCC...)
            }
        };
        logAction = 'Đặt linh kiện';
        logDetails = `Yêu cầu đặt hàng. Note: ${data.note}`;
    }
    else if (action === 'PARTS_ARRIVED') {
        // Hàng đã về
        updateData = {
            currentStatus: 'Đã có hàng', // Trạng thái mới để KTV biết
            partOrder: {
                ...currentTicket.partOrder, // Giữ thông tin đặt
                arriveDate: new Date().toISOString(),
                arriveBy: userName
            }
        };
        logAction = 'Linh kiện đã về';
        logDetails = 'Đã có hàng. KTV có thể tiến hành sửa.';
    }
    else if (action === 'REPAIR_COMPLETE') {
        // KTV báo cáo đã sửa xong
        updateData = {
            currentStatus: 'Chờ trả máy', // Chuyển trạng thái để CSKH biết mà gọi khách
            repair: {
                technicianName: userName,
                technicianEmail: userEmail,
                completionDate: new Date().toISOString(),
                workDescription: data.workDescription, // Công việc thực hiện
                warranty: data.warranty, // Bảo hành
                photos: data.photos || [] // Ảnh sau khi sửa
            }
        };
        logAction = 'Hoàn tất sửa chữa';
        logDetails = `Nội dung: ${data.workDescription}. BH: ${data.warranty}`;
    }
    else if (action === 'RETURN_DEVICE') {
        // Trả máy & Thu tiền
        updateData = {
            currentStatus: 'Hoàn tất', // Trạng thái cuối cùng
            payment: {
                staffName: userName,
                staffEmail: userEmail,
                date: new Date().toISOString(),
                totalAmount: Number(data.totalAmount) || 0, // Số tiền thực thu
                method: data.method, // Tiền mặt/CK...
                ticketNumber: data.ticketNumber, // Số sổ 3 liên
                note: data.note,
                photos: data.photos || [] // Ảnh bàn giao
            }
        };
        
        const moneyFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(updateData.payment.totalAmount);
        logAction = 'Trả máy & Thu tiền';
        logDetails = `Thu: ${moneyFormatted}. Sổ: ${data.ticketNumber}. HT: ${data.method}`;
    }

    // Cập nhật Firestore
    if (Object.keys(updateData).length > 0) {
        await ticketRef.update(updateData);
        
        // Ghi log
        await db.collection('repair_logs').add({
            ticketId: ticketId,
            timestamp: new Date().toISOString(),
            user: userName,
            action: logAction,
            details: logDetails
        });
    }

    return { ok: true };
}
// Xuất module
module.exports = {
    getTechnicianDashboardData,
    getTechnicians,
    getItemList,
    submitTransaction,
    getBorrowHistory,
    getTicketRanges,
    saveTicketRanges,
    submitErrorReport,
    processExcelData, 
    saveExcelData, 
    // consumeBorrowNote, // (Hàm này không còn cần thiết, logic đã gộp vào submitTransaction)
    verifyAndRegisterUser,
    rejectReturnNote,
    getReturnHistory,
    rejectBorrowNote,
    getPendingCounts,
    getSpeechAudio,
    managerTransferItems,
    getGlobalInventoryOverview,
    fixNegativeInventory,
    fixNegativeInventoryBatch, 
    createRepairTicket,
    getRepairTickets,
    getRepairTicket, 
    updateRepairTicket, // <-- THÊM DÒNG NÀY
};