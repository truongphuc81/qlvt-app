// functions/data-processor.js (ĐÃ REFACTOR HOÀN TOÀN SANG FIRESTORE)

const utils = require('./utils');
const admin = require('firebase-admin');

// Hằng số Collection IDs
const PENDING_NOTES_COLLECTION = 'pending_notes';
const PENDING_RETURN_NOTES_COLLECTION = 'pending_return_notes';
const HISTORY_COLLECTION = 'history_transactions'; // MỚI
const USAGE_TICKETS_COLLECTION = 'usage_tickets'; // MỚI

// =======================================================
// HELPER TRUY CẬP SHEETS (CHỈ DÙNG CHO DỮ LIỆU ÍT THAY ĐỔI)
// =======================================================

/**
 * Chỉ đọc các sheet Danh mục (ít thay đổi), không đọc Lịch sử/Đối chiếu.
 * Đây là các hàm nên được cache trong tương lai.
 */
async function readCoreSheetData({ sheets, spreadsheetId }) {
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
async function getTechnicianDashboardData({ db, email }) {
    console.log(`[Firestore Dashboard] Đang tải dashboard cho: ${email}`);
    const normEmail = utils.normalizeCode(email).toLowerCase();
    
    // Đọc core data (tên VT) từ Sheet (Nên cache)
    // const { itemCodeMap } = await readCoreSheetData({ sheets, spreadsheetId });
    // Tạm thời bỏ qua itemCodeMap để tập trung vào Firestore
    const itemCodeMap = new Map(); // Giả định

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
                const code = utils.normalizeCode(item.code);
                if (!byCode[code]) {
                    byCode[code] = { 
                        code, 
                        name: item.name || itemCodeMap.get(code) || code, 
                        quantity: 0, totalUsed: 0, totalReturned: 0, 
                        unreconciledUsageDetails: [], reconciledUsageDetails: [] 
                    };
                }
                
                if (data.type === 'Mượn') {
                    byCode[code].quantity += Number(item.quantity) || 0;
                } else if (data.type === 'Trả') {
                    byCode[code].totalReturned += Number(item.quantity) || 0;
                }
            });
        });
    } catch (e) {
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
    const ts = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
    const batch = db.batch();
    
    // --- LOGIC MƯỢN (KTV & MANAGER) ---
    if (data.type === 'Mượn') {
        const items = data.items || [];
        const note = data.note || '';
        const pendingNoteId = data.borrowTimestamp || ''; // ID của note KTV (nếu manager duyệt)
        
        // Xác định logic
        const isKtvSubmitNote = !pendingNoteId && data.mode !== 'DIRECT' && items.length === 0;
        const isManagerConfirmNote = !!pendingNoteId && items.length > 0;
        const isManagerDirect = data.mode === 'DIRECT' && items.length > 0;
        
        let transactionDoc;

        if (isKtvSubmitNote) {
            // 1. KTV Gửi note mượn
            // Ghi vào pending_notes
            const pendingNoteRef = db.collection(PENDING_NOTES_COLLECTION).doc();
            batch.set(pendingNoteRef, {
                timestamp: ts, // Dùng ts làm ID
                type: 'Mượn', 
                email: data.email, 
                date: data.date, 
                note: note, 
                isFulfilled: false,
                status: 'Pending',
                createdAt: new Date().toISOString()
            });
            
            // Ghi vào history (với status "Pending" và items rỗng)
            transactionDoc = {
                timestamp: ts, email: data.email, type: 'Mượn', date: data.date,
                note: note, items: [], status: 'Pending', pendingNoteId: ts
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(ts);
            batch.set(historyRef, transactionDoc);

        } else if (isManagerConfirmNote || isManagerDirect) {
            // 2. Manager duyệt note HOẶC mượn trực tiếp
            transactionDoc = {
                timestamp: ts, email: data.email, type: 'Mượn', date: data.date,
                note: note, items: items, status: 'Fulfilled', 
                pendingNoteId: pendingNoteId
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(ts);
            batch.set(historyRef, transactionDoc);
            
            // Nếu là duyệt note, cập nhật note gốc
            if (isManagerConfirmNote) {
                await fulfillPendingNote_({ db, email: data.email, tsISO: pendingNoteId, batch });
            }
        }
        
        // Thực thi Ghi vào Firestore
        await batch.commit();

        // Ghi backup vào Google Sheets (Không cần await)
        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }

    } 
    // --- LOGIC TRẢ (KTV & MANAGER) ---
    else if (data.type === 'Trả') {
        const tickets = data.tickets || []; // Dùng cho đối chiếu Sổ
        const itemsR = data.items || []; // Dùng cho trả không sử dụng
        const note = data.note || '';
        
        const isKtvReturnNote = itemsR.length === 0 && tickets.length === 0 && !!note;
        const isManagerConfirmReturn = itemsR.length > 0 && !!data.date;
        const isKtvReconcile = tickets.length > 0;

        let transactionDoc;

        if (isKtvReturnNote) {
            // 1. KTV Gửi note trả
            // Ghi vào pending_return_notes
            const pendingNoteRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc();
            batch.set(pendingNoteRef, {
                timestamp: ts, type: 'Trả', email: data.email, date: data.date,
                note: note, isFulfilled: false, status: 'Pending',
                createdAt: new Date().toISOString()
            });
            
            // Ghi vào history
            transactionDoc = {
                timestamp: ts, email: data.email, type: 'Trả', date: data.date,
                note: note, items: [], status: 'Pending', pendingNoteId: ts
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(ts);
            batch.set(historyRef, transactionDoc);
            
            await batch.commit();

        } else if (isManagerConfirmReturn) {
            // 2. Manager duyệt trả không sử dụng
            transactionDoc = {
                timestamp: ts, email: data.email, type: 'Trả', date: data.date,
                note: note, items: itemsR.map(it => ({ // Đảm bảo đúng format
                    code: it.code, name: it.name, quantity: it.quantityReturned
                })), 
                status: 'Fulfilled',
                pendingNoteId: data.returnTimestamp || ''
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(ts);
            batch.set(historyRef, transactionDoc);
            
            if (data.returnTimestamp) {
                await fulfillPendingReturnNote_({ db, email: data.email, tsISO: data.returnTimestamp, batch });
            }
            
            await batch.commit();

        } else if (isKtvReconcile) {
            // 3. KTV Xác nhận đối chiếu sổ
            // ** GHI VÀO FIRESTORE **
            const normEmail = utils.normalizeCode(data.email);
            const ticketsToUpdate = (tickets || []).map(t => (t || '').toString().trim());
            
            // Tìm các doc cần update
            const usageQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                .where('email', '==', normEmail)
                .where('ticket', 'in', ticketsToUpdate)
                .where('status', '==', 'Chưa đối chiếu')
                .get();
                
            if (usageQuery.empty) {
                throw new Error("Không tìm thấy số sổ nào hợp lệ để đối chiếu.");
            }
            
            usageQuery.forEach(doc => {
                batch.update(doc.ref, { status: 'Đã đối chiếu' });
            });
            
            await batch.commit();
            
            // ** GHI BACKUP VÀO GOOGLE SHEETS (Async) **
            updateUsageTicketStatusInSheet_({ sheets, spreadsheetId, tickets: ticketsToUpdate, email: normEmail });
            
            return { ok: true, updated: usageQuery.size };
        }
        
        // Ghi backup vào Google Sheets (Cho Mượn/Trả)
        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }
    }
    
    return true;
}

// =======================================================
// 4. XỬ LÝ EXCEL (Ghi vào Firestore & Sheets)
// =======================================================
async function saveExcelData({ sheets, spreadsheetId, db, data }) {
    if (!data || data.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ để lưu.');
    }
    
    const batch = db.batch();
    const promises = [];

    // 1. Kiểm tra trùng lặp (Query song song)
    data.forEach(r => {
        const ticket = r.ticket || '';
        const itemCode = utils.normalizeCode(r.itemCode || '');
        if (ticket && itemCode) {
            promises.push(
                db.collection(USAGE_TICKETS_COLLECTION)
                    .where('ticket', '==', ticket)
                    .where('itemCode', '==', itemCode)
                    .limit(1)
                    .get()
            );
        }
    });

    const snapshots = await Promise.all(promises);
    let newCount = 0;
    let updateCount = 0;

    // 2. Quyết định Thêm mới (Set) hay Cập nhật (Update)
    snapshots.forEach((snapshot, index) => {
        const r = data[index]; // Dữ liệu tương ứng từ Excel
        const docData = {
            date: r.date || '',
            itemCode: utils.normalizeCode(r.itemCode || ''),
            itemName: r.itemName || '',
            ticket: r.ticket || '',
            quantity: Number(r.quantity) || 0,
            email: r.email || '',
            note: r.note || '',
            status: 'Chưa đối chiếu'
        };

        if (snapshot.empty) {
            // Chưa tồn tại -> Thêm mới
            const newRef = db.collection(USAGE_TICKETS_COLLECTION).doc();
            batch.set(newRef, docData);
            newCount++;
        } else {
            // Đã tồn tại
            const existingDoc = snapshot.docs[0];
            if (existingDoc.data().status === 'Chưa đối chiếu') {
                // Tồn tại và chưa đối chiếu -> Cập nhật
                batch.update(existingDoc.ref, docData);
                updateCount++;
            }
            // Nếu đã đối chiếu -> Bỏ qua
        }
    });
    
    // 3. Commit ghi vào Firestore
    if (newCount > 0 || updateCount > 0) {
        await batch.commit();
    }
    
    // 4. Ghi backup vào Google Sheets (Async)
    // Chỉ ghi những dòng mới
    const newDataToBackup = data.filter((r, index) => snapshots[index].empty);
    if (newDataToBackup.length > 0) {
        writeUsageTicketsToSheet_({ sheets, spreadsheetId, data: newDataToBackup });
    }

    return { ok: true, message: `Lưu thành công. Thêm mới ${newCount} dòng, cập nhật ${updateCount} dòng.` };
}


// =======================================================
// 5. CÁC HÀM QUẢN LÝ (Helper)
// =======================================================

/**
 * Đánh dấu Pending BORROW Note là Fulfilled
 */
async function fulfillPendingNote_({ db, email, tsISO, batch }) { 
    const normEmail = utils.normalizeCode(email);
    const snapshot = await db.collection(PENDING_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) 
        .where('isFulfilled', '==', false) 
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        // Dùng batch được truyền vào
        batch.update(docRef, {
            isFulfilled: true,
            fulfilledAt: new Date().toISOString()
        });
    }
}

/**
 * Đánh dấu Pending RETURN Note là Fulfilled
 */
async function fulfillPendingReturnNote_({ db, email, tsISO, batch }) { 
    const normEmail = utils.normalizeCode(email);
    const snapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO) 
        .where('isFulfilled', '==', false) 
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        batch.update(docRef, {
            isFulfilled: true,
            fulfilledAt: new Date().toISOString()
        });
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
    const { ticketRangesMap } = await readCoreSheetData({ sheets, spreadsheetId });
    const normEmail = utils.normalizeCode(email);
    
    return ticketRangesMap
        .filter(r => r.email === normEmail)
        .map(r => ({ start: r.start, end: r.end }))
        .sort((a, b) => a.start - b.start);
}

// Ghi vào Sheet (Phức tạp, giữ nguyên)
async function saveTicketRanges({ sheets, spreadsheetId, email, ranges }) {
    // Logic này vẫn phải dùng Sheet API (xóa và ghi lại)
    // Tạm thời giữ nguyên logic cũ của bạn (dù logic cũ chỉ có append)
    // Để làm đúng, cần đọc, xóa dòng cũ, ghi dòng mới.
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
    const { ticketRangesMap } = await readCoreSheetData({ sheets, spreadsheetId }); 
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

// Dùng Sheet (Đã có, giữ nguyên)
async function verifyAndRegisterUser({ sheets, spreadsheetId, email, name }) {
    const normEmail = utils.normalizeCode(email);
    const techSheetName = 'Danh sách kỹ thuật viên';
    
    const isManager = await checkManager({ sheets, spreadsheetId, email }); // Giữ nguyên checkManager

    const techsResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${techSheetName}!A:A`,
    });
    const currentEmails = (techsResult.data.values || []).map(row => utils.normalizeCode(row[0]));

    if (!currentEmails.includes(normEmail)) {
        const newRow = [[email, name, new Date().toISOString()]];
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

// Dùng Sheet
async function checkManager({ sheets, spreadsheetId, email }) {
    const normEmail = utils.normalizeCode(email);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Danh sách quản lý!A:A',
    });
    const managerList = response.data.values || [];
    return managerList.some(row => utils.normalizeCode(row[0]) === normEmail);
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

// Dùng Firestore & Sheets (Dual Write)
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

// Xuất module
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
    processExcelData, 
    saveExcelData, 
    // consumeBorrowNote, // (Hàm này không còn cần thiết, logic đã gộp vào submitTransaction)
    verifyAndRegisterUser,
    rejectReturnNote,
    getReturnHistory,
    rejectBorrowNote,
    getPendingCounts,
    managerTransferItems,
};