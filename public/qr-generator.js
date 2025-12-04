document.addEventListener('DOMContentLoaded', function() {
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const groupFilter = document.getElementById('groupFilter');
    const generateBtn = document.getElementById('generateBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const qrContainer = document.getElementById('qr-container');
    const materialsChecklistContainer = document.getElementById('materials-checklist-container');
    const checklistActions = document.getElementById('checklist-actions');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');

    let materials = [];
    let materialGroups = new Set();

    auth.onAuthStateChanged(user => {
        if (user) {
            userEmailDisplay.textContent = user.email;
            loadMaterials();
        } else {
            window.location.href = 'index.html';
        }
    });

    async function loadMaterials() {
        try {
            const snapshot = await db.collection('inventory').get();
            snapshot.forEach(doc => {
                const material = { id: doc.id, ...doc.data() };
                materials.push(material);
                if (material.itemGroup) {
                    materialGroups.add(material.itemGroup);
                }
            });
            populateGroupFilter();
            updateChecklist('all'); // Initial population of the checklist
        } catch (error) {
            console.error("Error loading materials: ", error);
            alert("Không thể tải danh sách vật tư.");
        }
    }

    function populateGroupFilter() {
        materialGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group;
            groupFilter.appendChild(option);
        });
    }

    function createChecklistItem(material, isChecked = true) {
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'd-flex align-items-center mb-1 material-item';

        const formCheck = document.createElement('div');
        formCheck.className = 'form-check flex-grow-1';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'form-check-input';
        input.value = material.id;
        input.id = `chk-${material.id}`;
        input.checked = isChecked;

        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = `chk-${material.id}`;
        label.textContent = material.name;

        formCheck.appendChild(input);
        formCheck.appendChild(label);

        const quantityInput = document.createElement('input');
        quantityInput.type = 'number';
        quantityInput.className = 'form-control form-control-sm ms-2';
        quantityInput.style.width = '70px';
        quantityInput.value = material.quantity;
        quantityInput.min = 0;
        quantityInput.id = `qty-${material.id}`;

        itemWrapper.appendChild(formCheck);
        itemWrapper.appendChild(quantityInput);
        return itemWrapper;
    }

    function updateChecklist(selectedGroup) {
        const searchContainer = document.getElementById('search-container');
        const checklistContent = materialsChecklistContainer.querySelector('.checklist-content');
        if (checklistContent) {
            checklistContent.remove();
        }

        const newChecklistContent = document.createElement('div');
        newChecklistContent.className = 'checklist-content';

        if (selectedGroup === 'all') {
            searchContainer.style.display = 'block';
            materials.forEach(material => {
                const item = createChecklistItem(material, false); // Default to unchecked for 'all'
                newChecklistContent.appendChild(item);
            });
            materialsChecklistContainer.appendChild(newChecklistContent);
            materialsChecklistContainer.style.display = 'block';
            checklistActions.style.display = 'block';
        } else {
            searchContainer.style.display = 'none';
            const materialsInGroup = materials.filter(m => m.itemGroup === selectedGroup);

            if (materialsInGroup.length > 0) {
                materialsInGroup.forEach(material => {
                    const item = createChecklistItem(material);
                    newChecklistContent.appendChild(item);
                });
                materialsChecklistContainer.appendChild(newChecklistContent);
                materialsChecklistContainer.style.display = 'block';
                checklistActions.style.display = 'block';
            } else {
                materialsChecklistContainer.style.display = 'none';
                checklistActions.style.display = 'none';
            }
        }
    }

    groupFilter.addEventListener('change', () => {
        updateChecklist(groupFilter.value);
    });

    // Add search functionality
    const materialSearchInput = document.getElementById('materialSearch');

    materialSearchInput.addEventListener('input', () => {
        // Chuyển từ khóa tìm kiếm sang chữ thường và bỏ dấu
        const searchTerm = removeVietnameseTones(materialSearchInput.value.toLowerCase());
        const items = materialsChecklistContainer.querySelectorAll('.material-item');
        
        items.forEach(item => {
            // Lấy nội dung tên vật tư, chuyển sang chữ thường và bỏ dấu
            const labelContent = removeVietnameseTones(item.querySelector('.form-check-label').textContent.toLowerCase());
            
            if (labelContent.includes(searchTerm)) {
                // Tìm thấy: Hiện lên
                // Xóa class d-none (ẩn) và Thêm class d-flex (để căn chỉnh đẹp)
                item.classList.remove('d-none');
                item.classList.add('d-flex');
            } else {
                // Không tìm thấy: Ẩn đi
                // Thêm class d-none (ẩn tuyệt đối) và Xóa class d-flex (để tránh xung đột)
                item.classList.add('d-none');
                item.classList.remove('d-flex');
            }
        });
    });

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = materialsChecklistContainer.querySelectorAll('.material-item');
        checkboxes.forEach(item => {
            if (item.style.display !== 'none') {
                const chk = item.querySelector('input[type="checkbox"]');
                if (chk) {
                    chk.checked = true;
                }
            }
        });
    });

    deselectAllBtn.addEventListener('click', () => {
        const checkboxes = materialsChecklistContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(chk => chk.checked = false);
    });

    generateBtn.addEventListener('click', () => {
        const selectedGroup = groupFilter.value; // Keep for filename
        let materialsToPrint = [];

        const selectedCheckboxes = Array.from(materialsChecklistContainer.querySelectorAll('input[type="checkbox"]:checked'));
        
        if (selectedCheckboxes.length > 0) {
            materialsToPrint = selectedCheckboxes.map(chk => {
                const material = materials.find(m => m.id === chk.value);
                const quantityInput = document.getElementById(`qty-${material.id}`);
                const customQuantity = parseInt(quantityInput.value, 10);
                
                return {
                    ...material,
                    quantity: isNaN(customQuantity) ? 0 : customQuantity
                };
            });
        }

        qrContainer.innerHTML = '';

        if (materialsToPrint.length === 0) {
            alert("Không có vật tư nào được chọn để in.");
            exportPdfBtn.disabled = true;
            return;
        }

        let hasItemsToPrint = false;
        materialsToPrint.forEach(material => {
            if (material.quantity > 0) {
                hasItemsToPrint = true;
                for (let i = 0; i < material.quantity; i++) {
                    const qrItem = document.createElement('div');
                    qrItem.className = 'qr-item';

                    const qrCodeDiv = document.createElement('div');
                    qrCodeDiv.className = 'qr-code';
                    
                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'info';
                    infoDiv.textContent = material.name;
                    
                    qrItem.appendChild(qrCodeDiv);
                    qrItem.appendChild(infoDiv);
                    qrContainer.appendChild(qrItem);

                    new QRCode(qrCodeDiv, {
                        text: material.code,
                        width: 256,
                        height: 256,
                        correctLevel: QRCode.CorrectLevel.H
                    });
                }
            }
        });
        
        if (!hasItemsToPrint) {
            alert("Số lượng in của các vật tư được chọn đều bằng 0.");
        }

        exportPdfBtn.disabled = !hasItemsToPrint;
    });
    function removeVietnameseTones(str) {
        str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a"); 
        str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e"); 
        str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i"); 
        str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o"); 
        str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u"); 
        str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y"); 
        str = str.replace(/đ/g,"d");
        str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
        str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
        str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
        str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
        str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
        str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
        str = str.replace(/Đ/g, "D");
        // Một số hệ thống mã hóa tiếng Việt khác
        str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); 
        str = str.replace(/\u02C6|\u0306|\u031B/g, ""); 
        // Xóa khoảng trắng thừa
        str = str.trim(); 
        return str;
    }
    exportPdfBtn.addEventListener('click', () => {
        const selectedGroup = groupFilter.value;
        const filename = `qrcodes-${selectedGroup.replace(/\s+/g, '_') || 'all'}.pdf`;

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4'
        });

        const qrContainerElement = document.getElementById('qr-container');
        
        html2canvas(qrContainerElement, { 
            scale: 5, // Higher scale for better resolution
            useCORS: true,
            width: qrContainerElement.offsetWidth,
            height: qrContainerElement.offsetHeight
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            // Calculate the aspect ratio to avoid distortion
            const canvasAspectRatio = canvas.width / canvas.height;
            
            let finalImgWidth, finalImgHeight;

            // Fit image to page width while maintaining aspect ratio
            finalImgWidth = pdfWidth;
            finalImgHeight = finalImgWidth / canvasAspectRatio;

            // If the calculated height is greater than the page height, 
            // it means the content is very long. For now, we'll cap it at the page height.
            // A more advanced solution for multi-page is possible but much more complex.
            if (finalImgHeight > pdfHeight) {
                console.warn("Nội dung dài hơn một trang, có thể bị cắt bớt trong PDF.");
                finalImgHeight = pdfHeight;
            }

            // Add image to PDF, ensuring no distortion and disabling compression
            pdf.addImage(imgData, 'PNG', 0, 0, finalImgWidth, finalImgHeight, undefined, 'NONE');
            pdf.save(filename);
        });
    });
});
