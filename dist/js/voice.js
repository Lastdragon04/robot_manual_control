document.addEventListener('DOMContentLoaded', () => {
    const modify_box=document.getElementById("modify-knowledge-modal")
    const searchInput = document.getElementById('searchInput');
    const table = document.getElementById('knowledge-table');
    const rows = table.tBodies[0].rows;

    $(`#knowledge-table-change`).click(function(){
        const knowledge_config_box=document.getElementById("knowledge_config_box")
        if(knowledge_config_box.style.height==="1px"){
            knowledge_config_box.style.height="84vh"
        }
        else{
            knowledge_config_box.style.height="1px"
        }
    })

    $(`#knowledge-add`).click(function(){
        const out_box=document.getElementById(`add-knowledge-modal`)
        out_box.style.display="block"
    })

    // 搜索功能
    function searchTable() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        
        // 清除之前的高亮
        Array.from(rows).forEach(row => {
            row.classList.remove('highlight');
        });

        if (!searchTerm) return;

        // 遍历所有行
        Array.from(rows).some(row => {
            const cells = row.cells;
            
            // 检查每个单元格
            const found = Array.from(cells).some(cell => {
                return cell.textContent.toLowerCase().includes(searchTerm);
            });

            if (found) {
                row.classList.add('highlight');
                
                // 平滑滚动到高亮行
                row.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
                
                
            }
            return false;
        });
    }

    // 添加输入事件监听
    searchInput.addEventListener('input', searchTable);

    document.querySelectorAll('#add-knowledge-modal').forEach(container => {
        container.addEventListener('change', (event) => {
            if (event.target && event.target.id==="add_answer_type") {
                if(event.target.value!=2){
                    $(`#add_bind_action_group`).parent().css("display","none")
                }
                if(event.target.value==2){
                    $(`#add_bind_action_group`).parent().css("display","flex")
                }
            }
        });
    });
    document.querySelectorAll('#modify-knowledge-modal').forEach(container => {
        container.addEventListener('change', (event) => {
            if (event.target && event.target.id==="modify_answer_type") {
                if(event.target.value!=2){
                    $(`#modify_bind_action_group`).parent().css("display","none")
                }
                if(event.target.value==2){
                    $(`#modify_bind_action_group`).parent().css("display","flex")
                }
            }
        });
    });
})