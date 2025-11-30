document.addEventListener('DOMContentLoaded', function () {
    const KANBAN_BREAKPOINT = 768;

    const isMobile = () => window.innerWidth <= KANBAN_BREAKPOINT;

    // Function to handle the accordion logic
    function setupKanbanAccordion() {
        const kanbanBoard = document.querySelector('.kanban-board');
        if (!kanbanBoard) return;

        // Use event delegation for efficiency
        kanbanBoard.addEventListener('click', function(event) {
            if (!isMobile()) {
                return; // Guard clause: do nothing on desktop
            }
            
            const header = event.target.closest('.kanban-header');
            if (header) {
                header.classList.toggle('active');
            }
        });
    }
    
    // Function to reset the view when switching to desktop
    function resetToDesktopView() {
        if (!isMobile()) {
            const activeHeaders = document.querySelectorAll('.kanban-header.active');
            activeHeaders.forEach(header => {
                header.classList.remove('active');
            });
        }
    }

    // Initial setup
    setupKanbanAccordion();

    // Reset on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resetToDesktopView();
        }, 150); // Debounce for performance
    });
});
