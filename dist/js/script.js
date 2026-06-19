document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.menu');
    const main_content = document.querySelectorAll('.main-content');
    const motor_modal = document.getElementById("motor-modal");
    const modify_motor_modal=document.getElementById("motor-modify-modal");
    const control_modal = document.getElementById("control-modal");
    const modify_control_modal=document.getElementById("control-modify-modal");
    const select_motor = document.getElementById('motor_select');
    const modify_select_motor = document.getElementById('modify_motor_select');
    const select_control_type = document.getElementById('control_type');
    const modify_select_control_type = document.getElementById('modify_control_type');
    

    navLinks.forEach((link,index) => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active')); // Remove active class from all links
            main_content.forEach(m => m.classList.remove('active'))
            link.classList.add('active'); // Add active class to clicked link
            main_content[index].classList.add("active")
        });
    });

    // Open the modal when the button is clicked
    $("#openModalBtn1").click(function() {
        motor_modal.style.display = "block";
        // 自动填入下一个可用 motor_id
        $.ajax({
            type: 'get',
            url: '/motor/get_all',
            data: {robot_id: parseInt(localStorage.getItem('current_robot_id')) || 1},
            success: function(res) {
                var maxId = 0;
                (res.motors || []).forEach(function(m) { if (m.motor_id > maxId) maxId = m.motor_id; });
                $('#motor_id').val(maxId + 1);
            }
        });
    })
    $("#openModalBtn2").click(function() {
        control_modal.style.display = "block";
        $('.union_control').remove();
        $(`#choose_motor_output`).children('div').remove();
        modify_control_form("add");
    })


    // Close the modal when the close button is clicked
    // $(`#closeModalBtn1`).click( function() {
    //     motor_modal.style.display = "none";
    // })
    // $(`#closeModalBtn2`).click( function() {
    //     control_modal.style.display = "none";
    //     select_control_type.selectedIndex = 0;
    // })
    // $(`#closeModalBtn3`).click( function() {
    //     modify_motor_modal.style.display = "none";
    // })
    // $(`#closeModalBtn4`).click( function() {
    //     modify_control_modal.style.display = "none";
    // })

    $('.close-btn').click(function() {
        var modalId = $(this).closest('.modal').attr('id');
        $(`#${modalId}`).css('display', 'none');
    });

    function modify_control_form(modify_){
        let form_type=""
        if (modify_==="modify"){
            form_type="modify_"
        }
        $('.union_control').remove();
        $(`#${modify_}_controller_form`).append(
            `
            <div class="form_box union_control">
                <label for="${form_type}control_current_position">当前位置</label>
                <input type="number" class="form-control" id="${form_type}control_current_position" placeholder="当前位置">
            </div>
            <div class="form_box union_control">
                <label for="${form_type}control_offset">偏移量</label>
                <input type="number" class="form-control" id="${form_type}control_offset" placeholder="偏移量" value="0.0">
            </div>
            <div class="form_box union_control">
                <label for="${form_type}control_max_position">最大位置</label>
                <input type="number" class="form-control" id="${form_type}control_max_position" placeholder="最大位置">
            </div>
            <div class="form_box union_control">
                <label for="${form_type}control_min_position">最小位置</label>
                <input type="number" class="form-control" id="${form_type}control_min_position" placeholder="最小位置">
            </div>
            <div class="form_box union_control">
                <label for="${form_type}control_default_position">默认位置</label>
                <input type="number" class="form-control" id="${form_type}control_default_position" placeholder="默认位置">
            </div>`
        )
    }

    if (select_control_type){
        select_control_type.addEventListener('change',function(){
            $(`#choose_motor_output`).children('div').remove();
            toggle_depends_drop_zone('')
        })
    }

    if(modify_select_control_type){
        modify_select_control_type.addEventListener('change',function(){
            $(`#modify_choose_motor_output`).children('div').remove();
            toggle_depends_drop_zone('modify_')
        })
    }

    function toggle_depends_drop_zone(form_type){
        // 协同控制的依赖已改为每个 motor 单独添加，全局 drop zone 不再显示
    }

    function setup_modal_drop(modal_id, drop_zone_id, drop_area_id, file_input_id, file_name_id){
        const modal=document.getElementById(modal_id)
        if(!modal) return

        // 点击 drop area 触发文件选择
        const drop_area=document.getElementById(drop_area_id)
        if(drop_area){
            drop_area.addEventListener('click',function(){
                document.getElementById(file_input_id).click()
            })
        }
        // 文件选择后的处理
        const file_input=document.getElementById(file_input_id)
        if(file_input){
            file_input.addEventListener('change',function(){
                if(this.files.length>0){
                    $(`#${file_name_id}`).text('📎 '+this.files[0].name)
                    drop_area.classList.add('has-file')
                }
            })
        }

        modal.addEventListener('dragover',function(e){
            e.preventDefault()
            e.stopPropagation()
            const drop_zone=document.getElementById(drop_zone_id)
            const drop_area=document.getElementById(drop_area_id)
            if(drop_zone && drop_zone.style.display!=='none'){
                drop_area.classList.add('drag-over')
            }
        })
        modal.addEventListener('dragleave',function(e){
            e.preventDefault()
            e.stopPropagation()
            const drop_area=document.getElementById(drop_area_id)
            drop_area.classList.remove('drag-over')
        })
        modal.addEventListener('drop',function(e){
            e.preventDefault()
            e.stopPropagation()
            const drop_zone=document.getElementById(drop_zone_id)
            const drop_area=document.getElementById(drop_area_id)
            drop_area.classList.remove('drag-over')
            if(!drop_zone || drop_zone.style.display==='none') return
            const files=e.dataTransfer.files
            if(files.length>0){
                const file=files[0]
                if(file.name.endsWith('.pkl')){
                    $(`#${file_name_id}`).text('📎 '+file.name)
                    drop_area.classList.add('has-file')
                    // 弹一下
                    drop_area.style.transform='scale(1.03)'
                    setTimeout(()=>{ drop_area.style.transform='scale(1)' },150)
                    const dt=new DataTransfer()
                    dt.items.add(file)
                    document.getElementById(file_input_id).files=dt.files
                } else {
                    // 抖一下表示拒绝
                    drop_area.style.transform='translateX(-4px)'
                    setTimeout(()=>{ drop_area.style.transform='translateX(4px)' },50)
                    setTimeout(()=>{ drop_area.style.transform='translateX(0)' },100)
                }
            }
        })
    }

    setup_modal_drop('control-modal','depends_drop_zone','drop_area','depends','depends_file_name')
    setup_modal_drop('control-modify-modal','modify_depends_drop_zone','modify_drop_area','modify_depends','modify_depends_file_name')

    function listening_select_motor(control_type,select_motor,outputDiv){
        const selectedOption = select_motor.options[select_motor.selectedIndex];
        if (selectedOption.value !== "0") {
    
            // 检查是否已经存在相同的选项
            let optionExists = false;
            const existingOptions = outputDiv.querySelectorAll('.motor_choose_output_div .motor_choose_text');
            existingOptions.forEach(span => {
                if (span.textContent === `${selectedOption.text}`) {
                    optionExists = true;
                }
            });
            // 如果不存在相同的选项，则添加新的选项
            if (!optionExists) {
                if(control_type==="0"){
                    alert("请选择控制类型")
                    select_motor.selectedIndex = 0;
                    return
                }
                if(control_type==="1"){
                    if(outputDiv.children.length>0){
                        alert("单独控制仅可选择一个电机进行控制")
                        select_motor.selectedIndex = 0;
                        return
                    }
                }
                const newOptionDiv = document.createElement('div');
                newOptionDiv.className = 'motor_choose_output_div';
                newOptionDiv.innerHTML = `<span class="motor_choose_text">${selectedOption.text}</span><span style="display:flex;gap:4px;align-items:center;"><span class="motor_choose_file" style="display:none;color:#007bff;font-size:11px;"></span><span class="motor_choose_dep" title="添加依赖">依赖</span><span class="motor_choose_del">×</span></span>`;
                outputDiv.appendChild(newOptionDiv);
            }
        }
        select_motor.selectedIndex = 0;
    }

    // 点击 × 删除已选电机
    $(document).on('click', '.motor_choose_del', function(e) {
        e.stopPropagation();
        $(this).closest('.motor_choose_output_div').remove();
    });

    // 暂存待上传的 pkl 文件 { motor_identifier: File }
    window.pending_pkl_files = {};

    // 点击"依赖"选择 .pkl 文件（暂不实际上传）
    $(document).on('click', '.motor_choose_dep', function(e) {
        e.stopPropagation();
        var div = $(this).closest('.motor_choose_output_div');
        var input = $('<input type="file" accept=".pkl" style="display:none;">');
        input.on('change', function() {
            if (this.files.length > 0) {
                var file = this.files[0];
                var text = div.find('.motor_choose_text').text();
                var match = text.match(/(\d+)$/);
                var key = match ? match[0] : text;
                window.pending_pkl_files[key] = file;
                div.attr('data-depends', file.name);
                div.find('.motor_choose_file').text(file.name).show();
            }
        });
        input.click();
    });

    if (select_motor){
        select_motor.addEventListener('change', function() {
            const control_type=$(`#control_type`).val()
            const outputDiv = document.getElementById('choose_motor_output');
            listening_select_motor(control_type,select_motor,outputDiv)
        });
    }

    if (modify_select_motor){
        modify_select_motor.addEventListener("change",function(){
            const control_type=$(`#modify_control_type`).val()
            const outputDiv = document.getElementById('modify_choose_motor_output');
            listening_select_motor(control_type,modify_select_motor,outputDiv)
        })
    }
    
    $(document).on('input', '.modify-form-control-range', function() {
        let rangeValue = $(this).val();
        let textInputId = '#modify_control-position-' + $(this).attr('id').split('-')[1];
        $(textInputId).val(rangeValue);
    });

    $(document).on('input', '.form-control-range', function() {
        let rangeValue = $(this).val();
        let textInputId = '#control-position-' + $(this).attr('id').split('-')[1];
        $(textInputId).val(rangeValue);
    });

    $(document).on('input', '.control-position-input', function() {
        let textInputId = $(this).val();
        let rangeValue = '#control-' + $(this).attr('id').split('-')[2];
        $(rangeValue).val(textInputId);
    });

    $(document).on('input', '.modify-control-position-input', function() {
        let textInputId = $(this).val();
        let rangeValue = '#modify_control-' + $(this).attr('id').split('-')[2];
        $(rangeValue).val(textInputId);
    });

    $(`#imu-table-change`).click(function(){
        const imu_config_box=document.getElementById("imu_config_box")
        if(imu_config_box.style.height==="1px"){
            imu_config_box.style.height="84vh"
        }
        else{
            imu_config_box.style.height="1px"
        }
    })

    $(`#add_group_window_open`).click(function(){
        const add_action_group_modal=document.getElementById("add-action-group-modal")
        add_action_group_modal.style.display="block"
    })

    function initializeScrollSync() {
        var left = document.querySelector(".action_tree_box"); // 使用正确的类选择器
        var right = document.getElementById("action_group_details");

        if (left && right) {
            // 绑定左边的滚动事件
            left.addEventListener('scroll', function() {
                var a = left.scrollTop;
                // 竖向滚动条同步
                right.scrollTop = a;
                // 横向滚动条同步
                right.scrollLeft = left.scrollLeft;
            });
        } else {
            console.error("Elements not found!");
        }
    }

    document.querySelectorAll('#modify_control_bar').forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('table_operation_btn_waring')){
                event.target.closest(`.form-group`).remove()
            }
        });
    });
});