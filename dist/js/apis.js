document.addEventListener('DOMContentLoaded', () => {
    var control_ajax;
    var action_ajax;
    var cache_bar={};

    // 点击页面任意位置关闭右键菜单
    document.addEventListener('click', function () {
        $('.timeline-context-menu').remove();
    });
    const motor_table = document.getElementById('motor_config_tb');
    const control_table = document.getElementById('control_config_tb');
    const control_page = document.getElementById('control_center');
    const modify_motor_modal=document.getElementById("motor-modify-modal");
    const modify_control_modal=document.getElementById("control-modify-modal");
    const add_action_group_modal=document.getElementById(`add-action-group-modal`);
    const add_action_modal= document.getElementById(`add-action-modal`);
    const action_group_details=document.getElementById('action_group_details');
    const default_current=5.0
    const default_speed=1.0
    const card_strech_time=1000;
    const ip = "192.168.31.40"
    const url=`http://${ip}:3754`;
    var imu_socket;
    var motor_data
    var motor_socket = new WebSocket(`ws://${ip}:8765`);
    imu_ws = null;
    var current_robot_id = parseInt(localStorage.getItem('current_robot_id')) || 2;

    // 页面加载时从数据库拉取机器人列表，填充下拉框
    function load_robot_options() {
        $.ajax({
            type: 'get',
            url: '/robot/get_all',
            success: function(res) {
                var robots = res.robots || [];
                if (robots.length === 0) return;
                var html = robots.map(function(r) {
                    return '<option value="' + r[0] + '">' + r[1] + '</option>';
                }).join('');
                $('#global_robot_select').html(html);
                $('#robot_type_select').html(html);
                // 如果存储的 robot_id 不在列表中，回退到第一个
                var ids = robots.map(function(r) { return r[0]; });
                if (ids.indexOf(current_robot_id) === -1) {
                    current_robot_id = ids[0];
                }
                $('#global_robot_select').val(current_robot_id);
                $('#robot_type_select').val(current_robot_id);
            }
        });
    }
    load_robot_options();

    $(document).on('change', '#global_robot_select', function(){
        current_robot_id = parseInt($(this).val()) || 2;
        localStorage.setItem('current_robot_id', current_robot_id);
        $('#robot_type_select').val(current_robot_id);
    });

    function setupMotorSocket(ws) {
        ws.onopen = function() { console.log('Motor WS connected'); };
        ws.onmessage = function(event) {
            motor_data = JSON.parse(event.data);
            motor_data.forEach(function(data, index) {
                const check_box = $(`#control-checkbox-${data[0]}`);
                const loading = $(`#control_bar_loading_${data[0]}`);
                if (data[1] === 0 && check_box.length) {
                    check_box.attr("disabled", true).css("display", "block");
                    loading.css("display", "none");
                }
                if (data[1] === 1 && check_box.length) {
                    check_box.attr("disabled", false).css("display", "block");
                    loading.css("display", "none");
                }
                if (data[1] === 2 && check_box.length) {
                    check_box.css("display", "none");
                    loading.css("display", "block");
                }
            });
        };
        ws.onerror = function(error) { console.error('WebSocket Error:', error); };
        ws.onclose = function(e) {
            console.log('Motor WS closed, reconnecting in 3s...');
            setTimeout(function() {
                motor_socket = new WebSocket(`ws://${ip}:8765`);
                setupMotorSocket(motor_socket);
            }, 3000);
        };
    }
    setupMotorSocket(motor_socket);

    // imu_ws.onmessage = function(event) {
    //     const angles = JSON.parse(event.data);
    //     document.getElementById('roll').textContent = angles[0].toFixed(2);
    //     document.getElementById('pitch').textContent = angles[1].toFixed(2);
    //     document.getElementById('yaw').textContent = angles[2].toFixed(2);
    // };

    // imu_ws.onerror = function(error) {
    //     console.error('WebSocket 错误:', error);
    // };

    // imu_ws.onclose = function() {
    //     console.log('WebSocket 连接关闭');
    // };

    function imu_angle_show(){
        var imu_ws = new WebSocket(`ws://${ip}:1100`);
        imu_ws.addEventListener('open', (event) => {
            console.log('websocket连接已建立');
        })
        imu_ws.addEventListener('message', (event) => {
            console.log(`收到: ${event.data}`);
            const angles = JSON.parse(event.data);
            document.getElementById('roll').textContent = angles[0].toFixed(2);
            document.getElementById('pitch').textContent = angles[1].toFixed(2);
            document.getElementById('yaw').textContent = angles[2].toFixed(2);
        });
        imu_ws.addEventListener('close', (event) => {
            isConnected = false;
            if (event.wasClean) {
                addMessageToLog(`连接已关闭，状态码: ${event.code}，原因: ${event.reason || '无'}`, 'system');
            } else {
                addMessageToLog('连接异常断开', 'error');
            }
        });
    }

    function modify_motor_window_open(motor_id){
        $.ajax({
            type: "get",
            url: "/motor/get_a_motor",
            data: {"motor_id":parseInt(motor_id)},
            success: function (response) {
                if(response.motor!==null){
                    const motor=response.motor
                    $(`#modify_motor`).attr("data",motor_id)
                    $(`#modify_motor_id`).val(motor.motor_id)
                    $(`#modify_can_rx_id`).val(motor.can_rx_id)
                    $(`#modify_can_tx_id`).val(motor.can_tx_id)
                    $(`#modify_motor_name`).val(motor.name)
                    $(`#modify_motor_current_position`).val(motor.current_position)
                    $(`#modify_motor_max_position`).val(motor.max_position)
                    $(`#modify_motor_min_position`).val(motor.min_position)
                    $(`#modify_motor_default_position`).val(motor.default_position)
                    $(`#modify_protocol`).val(motor.protocol)
                }     
            }
        });
        modify_motor_modal.style.display = "block";
    }

    function modify_control_window_open(element){
        $('.union_control').remove();
        const targetElement = element.parentNode.parentNode

        var cells = targetElement.getElementsByTagName("td");
        var cellContents = [];
        for (var i = 0; i < cells.length-2; i++) {
            cellContents.push(cells[i].textContent.trim());
        }
        console.log(cellContents)
        const motor_select = document.getElementById('modify_motor_select');
        const choose_motor_output = document.getElementById('modify_choose_motor_output');
        let control_mode = parseInt(targetElement.getAttribute('data-mode')) || 1
        let ctrl_type_val = cellContents[4].startsWith('单独') ? '1' : '2';
        $.ajax({
            type:"get",
            url:"/controller/get_motor_id",
            data:{"control_id":parseInt(cellContents[0])},
            success:function(response){
                const motor_id = (response.controller || []).map(String)
                const robot_id = response.robot_id
                // 如果是主节点，把从节点也拉进来显示
                var append_motors = motor_id.slice();
                if (response.slaves && response.slaves.length > 0) {
                    response.slaves.forEach(function(s) {
                        append_motors.push(String(s.name_index));
                    });
                }
                update_controller_form(motor_select, choose_motor_output, "modify_", append_motors, robot_id)
                // 回填从节点的依赖文件名
                if (response.slaves) {
                    response.slaves.forEach(function(s) {
                        if (s.depends) {
                            $(`#modify_choose_motor_output .motor_choose_output_div`).each(function(){
                                var text = $(this).find('.motor_choose_text').text();
                                if (text.match(new RegExp('-' + s.name_index + '$'))) {
                                    $(this).attr('data-depends', s.depends);
                                    $(this).find('.motor_choose_file').text(s.depends).show();
                                }
                            });
                        }
                    });
                }
                modify_control_form("modify");
                $("#modify_target").text(`修改${cellContents[0]}号控制节点`);
                $(`#modify_joint_name`).val(cellContents[1])
                $(`#modify_location`).val(cellContents[2])
                $(`#modify_urdf_name`).val(cellContents[3])
                $(`#modify_topic`).val(cellContents[5])
                $(`#modify_control_type`).val(ctrl_type_val)
                $(`#modify_control_mode`).val(control_mode)
                $(`#modify_control_type`).trigger('change')
                $(`#modify_control_current_position`).val(cellContents[6])
                $(`#modify_control_offset`).val(cellContents[7])
                $(`#modify_control_max_position`).val(cellContents[8])
                $(`#modify_control_min_position`).val(cellContents[9])
                $(`#modify_control_default_position`).val(cellContents[10])
                modify_control_modal.style.display = "block"
            }
        })
    }

    function add_actions_window_open(){
        const actions=get_control_form_action()
        console.log(actions)
        if(actions.length===0){
            alert("请先勾选需要添加的动作")
            return
        }
        $(`#add_action_seq`).val(0)
        update_action_form(actions,"add")
        // 清空并重新加载动作组下拉
        var sel = document.getElementById('add_action_select_group');
        sel.innerHTML = '<option value="0" selected>请选择动作组</option>';
        $.ajax({
            type:"get",
            url:"/action_group/get_all",
            data:{"robot_id": current_robot_id},
            success:function(response){
                if(response.groups){
                    response.groups.forEach(function(group,index){
                        sel.insertAdjacentHTML('beforeend', `<option value="${group[0]}">${group[1]}</option>`)
                    })
                }
                add_action_modal.style.display="block";
            },
            error: function(xhr, status, error) {
                console.error("An error occurred: " + error);
                add_action_modal.style.display="block";
            }
        })
    }

    function add_actions_group_window_open(){
        add_action_group_modal.style.display="block"
    }

    document.querySelectorAll('#motor_config_tb').forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('table_operation_btn_waring')) {
                const motorId = event.target.getAttribute('data-motor-delete-id');
                delete_motor(motorId);
            }
            if (event.target && event.target.classList.contains('table_operation_btn')) {
                const motorId = event.target.getAttribute('data-motor-modify-id');
                modify_motor_window_open(motorId);
            }
        });
    });

    // 打开修改动作模态框（从时间轴双击触发）
    function openModifyActionModal(action_id) {
        $.ajax({
            type: "get",
            url: "/action/get",
            data: {"action_id": action_id},
            success: function (response) {
                if (!response.action) return;
                const act = response.action;
                $('#modify_actionform input').val(null);
                $('#modify_control_bar .card_body').remove();
                $('#modify_action_name').val(act.name || act[2] || '');
                $('#modify_action_seq').val(act.start_time != null ? act.start_time : (act[3] || 0));
                // 兼容新旧格式
                const cmdData = Array.isArray(act.command) ? act.command : (act[4] || []);
                cmdData.forEach((data, index) => {
                    $('#modify_control_bar').append(`
                        <div class="form-group card_body" style="margin-bottom: 2%;" data="${action_id}">
                            <label for="modify_control-${data.motor_id}" style="width:25%">${data.location}|${data.joint_name}:</label>
                            <input type="range" class="modify-form-control-range" id="modify_control-${data.motor_id}" min="${data.min}" max="${data.max}" value="${data.position}" step="${(data.max-data.min)/100}"/>
                            <input type="number" class="modify-control-position-input" style="width:10%" value="${data.position}" id="modify_control-position-${data.motor_id}"
                                oninput="if(value>${data.max})value=${data.max};if(value<${data.min})value=${data.min}" step="${(data.max-data.min)/100}"/>
                            <label for="modify_control-speed-${data.motor_id}" style="width:10%">速度:</label>
                            <input type="number" style="width:10%" value="${data.speed}" id="modify_control-speed-${data.motor_id}" min="0" step="0.1" name_index="${data.name_index}"/>
                            <button class="table_operation_btn_waring" style="width: 30px;" data="${data.motor_id}">x</button>
                        </div>
                    `);
                });
                $('#modify-action-modal').css("display", "block");
                $('#modify-action-modal').attr("data", action_id);
                // 保存原始 track/start_time/duration，修改时保持不动
                $('#modify-action-modal').attr("data-track", act.track || act[5] || 1);
                $('#modify-action-modal').attr("data-start-time", act.start_time != null ? act.start_time : (act[3] || 0));
                $('#modify-action-modal').attr("data-duration", act.duration || act[6] || 2.0);
            }
        });
    }

    document.querySelectorAll(`#action_groups_cards_box`).forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('btn-danger')) {
                const group_id=event.target.getAttribute("data")
                $.ajax({
                    type: "delete",
                    url: "/action_group/delete",
                    data: {"group_id":parseInt(group_id)},
                    success: function (response) {
                        if(response.message==="success"){
                            refresh_action_group()
                            group_detail_off()
                        }
                    }
                });
            }
            if (event.target && event.target.classList.contains('edit')) {
                $(`#modify-action-group-modal`).css("display","flex")
                const group_id = event.target.getAttribute('data');
                $(`#modify_action_group`).attr("data",group_id)
                $.ajax({
                    type: "get",
                    url: "/action_group/get_group",
                    data: {"group_id":group_id},
                    success: function (response) {
                        console.log(response)
                        if(response){
                            $(`#modify_action_group_name`).val(response[1])
                            if(response[2]!==null){
                                $(`#modify_action_group_callback`).val(response[2])
                            }
                            $(`#modify_action_group_description`).val(response[3])
                        }
                    }
                });
            }
        })
    })

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

    document.querySelectorAll('#control_config_tb').forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('table_operation_btn_waring')) {
                const controlId = event.target.getAttribute('data-control-delete-id');
                const motor_id=event.target.getAttribute("motor_id")
                const isMaster = event.target.getAttribute('data-is-master') === 'true';
                if (isMaster) {
                    if (!confirm('该节点是协同控制主节点，删除将同时删除其下的所有从节点。确定删除吗？')) {
                        return;
                    }
                }
                delete_control(controlId,motor_id);
            }
            if (event.target && event.target.classList.contains('table_operation_btn')) {
                const controlId = event.target.getAttribute('data-control-modify-id');
                modify_control_window_open(event.target);
            }
            if (event.target.matches('[id^="depends-a-"]')) {
                const numbers = event.target.id.match(/\d+/g); 
                $(`#depends-upload-${numbers[0]}-${numbers[1]}`).click()
            }
        });
        container.addEventListener("change", (change_event) => {
            if (change_event.target.matches(`[id^="depends-upload-"]`)) {
                const numbers = change_event.target.id.match(/\d+/g); 
                if (change_event.target.files.length > 0) {
                    const file = change_event.target.files[0];
                    if (file.name.endsWith('.pkl')) {
                        $(`#depends-a-${numbers[0]}-${numbers[1]}`).text(file.name);
                        var formData = new FormData();
                        formData.append("file", file);
                        formData.append("control_id", numbers[0]);//此处需要加入motor_id
                        formData.append("motor_id",numbers[1])
                        $.ajax({
                            url: "/controller/depend/add",
                            type: "put",
                            data: formData,
                            processData: false,
                            contentType: false,
                            success: function(response) {
                                console.log("File uploaded successfully: " + response.filename);
                            },
                            error: function(xhr, status, error) {
                                console.error("An error occurred: " + error);
                            }
                        });
                    } else {
                        alert("文件不合规，请上传 .pkl 格式的文件");
                        change_event.target.value = ''; // 清空文件输入框
                    }
                } else {
                    alert("文件不合规");
                }
            }
        });

    });

    function update_control_bar(element){
        if (parseInt(element.getAttribute("control_type")) === 2){
            let temp = element.getAttribute("id").split("-")
            let control_id = parseInt(temp[temp.length - 1])
            console.log("旧"+String(cache_bar[String(control_id)]))
            console.log("新"+String(element.value))
            let form = {
                "control_id": control_id,
                "value": String(element.value-cache_bar[String(control_id)]),
                "data": []
            }
            let reflect = element.getAttribute("reflect").split(",")
            if (reflect !== null){
                for (let index = 0; index < reflect.length; index++) {
                    console.log($(`#control-${reflect[index]}`))
                    let temp_dict = {}
                    temp_dict["id"] = parseInt(reflect[index])
                    temp_dict["motor_id"] = parseInt($(`#control-${reflect[index]}`).attr("motor_ids"))
                    temp_dict["position"] = String($(`#control-${reflect[index]}`).val())
                    form["data"].push(temp_dict)
                }
            }
            cache_bar[String(control_id)]=element.value
            $.ajax({
                type: "post",
                url: "/control_bar/update",
                contentType: "application/json",
                data: JSON.stringify(form),
                success: function (response) {
                    console.log(response)
                    response.message.forEach(function(data){
                        $(`#control-${String(data.control_id)}`).val(data.position)
                        $(`#control-position-${String(data.control_id)}`).val(data.position)
                    })
                }
            });
        }
    }
    

    document.querySelectorAll(`#control_center`).forEach(container=> {
        container.addEventListener('click', (event)=>{
            if (event.target && event.target.classList.contains(`controller_running`)){
                const control_id=event.target.getAttribute("data")
                $.ajax({
                    type: "put",
                    url: "/control/stop_waiting",
                    data: {"control_id":parseInt(control_id)},
                    success: function (response) {
                        console.log("Stopping waiting control down")
                    }
                });
            }
        })
        container.addEventListener("change",(event=>{
            if (event.target && event.target.classList.contains("location_all_select")){
                const checkboxes=event.target.parentNode.parentNode.parentNode.querySelectorAll('input[type="checkbox"]')
                console.log(checkboxes)
                if(event.target.checked){
                    checkboxes.forEach(function(checkbox) {
                        checkbox.checked=true
                    });
                }
                else{
                    checkboxes.forEach(function(checkbox) {
                        checkbox.checked=false
                    });
                }
            }
            if (event.target && (event.target.classList.contains("form-control-range"))){
                update_control_bar(event.target)
            }
        }))
        container.addEventListener('change', (event)=>{
            if(event.target && event.target.classList.contains("control-position-input")){
                update_control_bar(event.target)
            }
        })
    })

    function get_controller_form(motor_selects,control_type,form_type){
        const numbers=[]
        const control_id=$(`#${form_type}control_id`).val()
        motor_selects.each(function(index,data){
            number=$(data).find('.motor_choose_text').text().match(/(\d+)$/)
            if (number) {
                // 将提取到的数字添加到数组中
                numbers.push(parseInt(number[0], 10));
            }
        })
        const loaction=$(`#${form_type}location`).val()
        let description=$(`#${form_type}control_description`).val()
        if(loaction===""){
            alert("请选择该关节所处位置")
            return false
        }
        if(description==""){
            description="该用户很懒，没有留下任何备注"
        }
        let data={
            "control_id":$(`#${form_type}control_id`).val(),
            "name":$(`#${form_type}joint_name`).val(),
            "location":loaction,
            "urdf_name":$(`#${form_type}urdf_name`).val(),
            "topic":$(`#${form_type}topic`).val(),
            "move_type":parseInt($(`#${form_type}control_type`).val()),
            "motor_id":String(numbers),
            "description":description,
            "robot_id": current_robot_id
        }

        if(control_type==="0"){
            alert("请选择控制类型")
            return false
        }
        if(control_type==="1"){
            Object.assign(data,{
                "control_mode":1,
                "current_position":$(`#${form_type}control_current_position`).val(),
                "offset":$(`#${form_type}control_offset`).val(),
                "max_position":$(`#${form_type}control_max_position`).val(),
                "min_position":$(`#${form_type}control_min_position`).val(),
                "default_position":$(`#${form_type}control_default_position`).val()
            })
        }
        // 收集每个电机的依赖文件
        var motor_depends = {};
        $(`#${form_type}choose_motor_output .motor_choose_output_div`).each(function(){
            var text = $(this).find('.motor_choose_text').text();
            var match = text.match(/(\d+)$/);
            var dep = $(this).attr('data-depends') || '';
            if (match && dep) {
                motor_depends[match[0]] = dep;
            }
        });
        var depends_value = '';
        if (control_type === '2' && Object.keys(motor_depends).length > 0) {
            depends_value = JSON.stringify(motor_depends);
        } else if (control_type === '1' && Object.keys(motor_depends).length > 0) {
            depends_value = Object.values(motor_depends)[0];
        }

        if(control_type==="2"){
            Object.assign(data,{
                "control_mode":parseInt($(`#${form_type}control_mode`).val()),
                "current_position":$(`#${form_type}control_current_position`).val(),
                "offset":$(`#${form_type}control_offset`).val(),
                "max_position":$(`#${form_type}control_max_position`).val(),
                "min_position":$(`#${form_type}control_min_position`).val(),
                "default_position":$(`#${form_type}control_default_position`).val(),
                "depends": depends_value
            })
        }
        return data
    }

    function get_control_form_action(){
        const motor_id_checkbox=$('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        let data=[]
        motor_id_checkbox.each(function() {
            const motor_id=$(this).attr('id').split("-")[2]
            // 跳过主节点（虚拟节点），主节点不应被添加到动作组
            if (motor_id && motor_id.startsWith('master_')) {
                return true; // continue to next
            }
            let action={}
            action["motor_id"]=motor_id
            action["location"] = $(this).parent().siblings('.card_title').children('label').text()
            action["name_index"]=$(this).attr("name_index")
            action["position"] = $(`#control-position-${motor_id}`).val()
            action["speed"] = $(`#control-speed-${motor_id}`).val()
            data.push(action)
        })
        return data
    }
    
    function get_add_action_group_form(form_type){
        let data={}
        data.name=$(`#${form_type}_action_group_name`).val()
        temp=$(`#${form_type}_action_group_callback`).val()
        if(temp){
            data.action_callback=temp
        }
        data.description=$(`#${form_type}_action_group_description`).val()
        data.robot_id = current_robot_id || 1
        return data
    }

    function update_controller_form(motor_select,choose_motor_output,form_type,append_motor_id,robot_id){
        while (motor_select.firstChild) {
            motor_select.removeChild(motor_select.firstChild);
        }
        while (choose_motor_output.firstChild) {
            choose_motor_output.removeChild(choose_motor_output.firstChild);
        }
        motor_select.insertAdjacentHTML('beforeend',`<option value="0" selected >请选择选择电机</option>`)
        $.ajax({
            type:"get",
            url:"/motor/get_all",
            data: robot_id ? {robot_id: robot_id} : {},
            success: function(data) { // 请求成功时的回调函数
                if (data.motors){
                    data.motors.forEach((motor, index) => {
                        motor_select.insertAdjacentHTML('beforeend',`<option value="${motor.motor_id}">${motor.name}-${motor.motor_id}</option>`)
                        if(form_type==="modify_" &&  append_motor_id.includes(String(motor.motor_id))){
                            const newOptionDiv = document.createElement('div');
                            newOptionDiv.className = 'motor_choose_output_div';
                            newOptionDiv.innerHTML = `<span class="motor_choose_text">${motor.name}-${motor.motor_id}</span><span style="display:flex;gap:4px;align-items:center;"><span class="motor_choose_file" style="display:none;color:#007bff;font-size:11px;"></span><span class="motor_choose_dep" title="添加依赖">依赖</span><span class="motor_choose_del">×</span></span>`;
                            choose_motor_output.appendChild(newOptionDiv);
                        }
                    })
                }
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
            console.error(error); // 在控制台打印错误信息
            }
        })
    }

    function update_action_form(form_data,form_type){
        let action_select_group=document.getElementById(`${form_type}_action_select_group`)
        const action_tb=document.getElementById(`${form_type}_action_tb`)
        while (action_tb.firstChild) {
            action_tb.removeChild(action_tb.firstChild);
        }
        while (action_select_group.firstChild) {
            action_select_group.removeChild(action_select_group.firstChild);
        }
        action_select_group.insertAdjacentHTML('beforeend',`<option value="0" selected >请选择选择动作组</option>`)
        form_data.forEach(function(action,index){
            $(`#${form_type}_action_tb`).append(`<tr id="action-from-${action.motor_id}"><td>${index}</td><td>${action.location}</td><td>${action.name_index}</td><td>${action.position}</td><td>${action.speed}</td></tr>`)
        })
    }

    function update_control_id(){
        $.ajax({
            type: "get",
            url: "/control/get_max_control_id",
            success: function (response) {
                if(response.maxid){
                    $(`#control_id`).val(response.maxid)
                }
            }
        });
    }

    $(`#add_motor`).click(function() {
        if($(`#protocol`).val()===0){
            alert("协议不能为空")
            loading_off("modify","motor")
            return 
        }
        loading_on("add","motor")
        var data={
            "motor_id":$(`#motor_id`).val(),
            "can_rx_id":$(`#can_rx_id`).val(),
            "can_tx_id":$(`#can_tx_id`).val(),
            "name":$(`#motor_name`).val(),
            "protocol":parseInt($(`#protocol`).val()),
            "current_position":$(`#motor_current_position`).val(),
            "max_position":$(`#motor_max_position`).val(),
            "min_position":$(`#motor_min_position`).val(),
            "default_position":$(`#motor_default_position`).val(),
            "robot_id": current_robot_id
        }
        $.ajax({
            type:"post",
            url:"/motor/add",
            data:data,
            success: function(response) { // 请求成功时的回调函数
                alert(response.message)
                if(response.message==="success"){
                    refresh_motor_page()
                }
                loading_off("add","motor")
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
                console.error(error); // 在控制台打印错误信息
                loading_off("add","motor")
            }
        })
    });

    // 上传所有暂存的 pkl 文件，完成后执行 callback
    function flush_pending_pkls(callback) {
        var keys = Object.keys(window.pending_pkl_files || {});
        if (keys.length === 0) { callback(); return; }
        var uploaded = 0, total = keys.length;
        keys.forEach(function(key) {
            var formData = new FormData();
            formData.append('file', window.pending_pkl_files[key]);
            $.ajax({
                type: 'post',
                url: '/controller/upload_pkl',
                data: formData,
                processData: false,
                contentType: false,
                success: function(res) {
                    uploaded++;
                    if (res.message !== 'success') alert(res.message);
                    if (uploaded >= total) { window.pending_pkl_files = {}; callback(); }
                },
                error: function(xhr) {
                    uploaded++;
                    alert('上传失败: ' + (xhr.responseJSON?.message || xhr.statusText));
                    if (uploaded >= total) { window.pending_pkl_files = {}; callback(); }
                }
            });
        });
    }

    $(`#add_controller`).click(function(){
        loading_on("add","controller")
        const motor_selects=$(`#choose_motor_output .motor_choose_output_div`)
        const control_type=$(`#control_type`).val()
        const data=get_controller_form(motor_selects,control_type,'')
        if(data===false){
            loading_off("add","controller")
            return
        }
        flush_pending_pkls(function() {
            $.ajax({
                type:"post",
                url:"/controller/add",
                data:data,
                success: function(response) {
                    alert(response.message)
                    if(response.message==="success"){
                        refresh_control_config_page()
                    }
                    loading_off("add","controller")
                },
                error: function(xhr, status, error) {
                    console.error(error);
                    loading_off("add","controller")
                }
            })
        })
    })

    $(`#openModalBtn2`).click(function (){ 
        const motor_select = document.getElementById('motor_select');
        const choose_motor_output = document.getElementById('choose_motor_output');
        update_controller_form(motor_select,choose_motor_output,'',[], current_robot_id)
        update_control_id()
    })

    $(`#modify_motor`).click(function (){
        loading_on("modify","motor")
        if($(`#modify_protocol`).val()==="0"){
            alert("协议不能为空")
            loading_off("modify","motor")
            return 
        }
        $.ajax({
            type:"put",
            url:"/motor/modify",
            data:{
                "motor_id":parseInt($(`#modify_motor`).attr("data")),
                "can_rx_id":$(`#modify_can_rx_id`).val(),
                "can_tx_id":$(`#modify_can_tx_id`).val(),
                "name":$(`#modify_motor_name`).val(),
                "protocol":parseInt($(`#modify_protocol`).val()),
                "current_position":$(`#modify_motor_current_position`).val(),
                "max_position":$(`#modify_motor_max_position`).val(),
                "min_position":$(`#modify_motor_min_position`).val(),
                "default_position":$(`#modify_motor_default_position`).val(),
                "boards_motor":parseInt($(`#modify_motor_id`).val()),
                "robot_id": current_robot_id
            },
            success: function(response) { // 请求成功时的回调函数
                if(response.message==="success"){
                    refresh_motor_page()
                    alert("success")
                }
                else{
                    alert(response.message)
                }
                loading_off("modify","motor")
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
                console.error(error); // 在控制台打印错误信息
                loading_off("modify","motor")
            }
        })
    })

    $(`#modify_controller`).click(function(){
        loading_on("modify","controller")
        const motor_selects=$(`#modify_choose_motor_output .motor_choose_output_div`)
        const control_type=$(`#modify_control_type`).val()

        let data=get_controller_form(motor_selects,control_type,'modify_')
        if(data===false){
            loading_off("modify","controller")
            return
        }
        number=$(`#modify_target`).text().match(/\d+/)
        data["control_id"]=String(number)

        flush_pending_pkls(function() {
        $.ajax({
            type:"put",
            url:"/controller/modify",
            data:data,
            success: function(response) { // 请求成功时的回调函数
                alert(response.message)
                if(response.message==="success"){
                    refresh_control_config_page()
                }
                loading_off("modify","controller")
            },
            error: function(xhr, status, error) {
                console.error(error);
                loading_off("modify","controller")
            }
        })
        });  // flush_pending_pkls
    })

    function delete_motor(motorId){
        $.ajax({
            type:"delete",
            url:"/motor/delete",
            data:{"motor_id":motorId},
            success: function(response) { // 请求成功时的回调函数
                if(response.message==="success"){
                    refresh_motor_page()
                }
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
            console.error(error); // 在控制台打印错误信息
            }
        })
    }

    function delete_control(controlId,motor_id){
        $.ajax({
            type:"delete",
            url:"/controller/delete",
            data: {"control_id": parseInt(controlId)},
            success: function(response) { // 请求成功时的回调函数
                if(response.message==="success"){
                    refresh_control_config_page()
                    group_detail_off()
                }
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
                console.error(error); // 在控制台打印错误信息
            }
        })
    }

    function refresh_motor_page(){
        while (motor_table.firstChild) {
            motor_table.removeChild(motor_table.firstChild);
        }
        var robot_id = current_robot_id;
        $.ajax({
            type: "get",
            url: "/motor/get_all",
            data: {robot_id: robot_id},
            success: function(response) {
                if (response.motors) {
                    response.motors.forEach(function(motor, index) {
                        var proto_text = '';
                        if (motor.protocol === 1) proto_text = '邱协议';
                        else if (motor.protocol === 2) proto_text = '老丁协议';
                        else proto_text = '未知';
                        motor_table.insertAdjacentHTML('beforeend',
                            `<tr>
                                <td>${index + 1}</td>
                                <td>${motor.motor_id}</td>
                                <td>${motor.can_rx_id}</td>
                                <td>${motor.can_tx_id}</td>
                                <td>${motor.name}</td>
                                <td>${proto_text}</td>
                                <td>${motor.current_position}</td>
                                <td>${motor.max_position}</td>
                                <td>${motor.min_position}</td>
                                <td>${motor.default_position}</td>
                                <td>
                                    <button class="table_operation_btn" data-motor-modify-id="${motor.id}">编辑</button>
                                    <button class="table_operation_btn_waring" data-motor-delete-id="${motor.id}">删除</button>
                                </td>
                            </tr>`);
                    });
                }
            }
        });
    }

    function refresh_control_config_page(){
        while (control_table.firstChild) {
            control_table.removeChild(control_table.firstChild);
        }
        $.ajax({
            type:"get",
            url:"/controller/get_all",
            data:{robot_id: current_robot_id},
            success: function(response) { // 请求成功时的回调函数
                response.controllers.forEach((el, index) => {
                    let ctrl_type_text, row_class;
                    if (el.is_master) {
                        ctrl_type_text = '协同-主';
                        row_class = 'coordinated-master-row';
                    } else if (el.master_id !== null && el.master_id !== undefined) {
                        ctrl_type_text = '协同-从(' + el.master_id + ')';
                        row_class = 'coordinated-slave-row';
                    } else {
                        ctrl_type_text = '单独控制';
                        row_class = '';
                    }
                    let motor_display = el.is_master ? '虚拟节点' : (el.motor_id || '---');
                    let depend = el.depends || '点击添加依赖'
                    let desc = el.description || '暂无描述'
                    control_table.insertAdjacentHTML('beforeend',
                        `<tr id="control-config-${el.id}-${el.motor_id}" data-mode="${el.control_mode}" title="${desc}" class="${row_class}">
                            <td>${el.id}</td>
                            <td>${el.name}</td>
                            <td>${el.location}</td>
                            <td>${el.urdf_name}</td>
                            <td>${ctrl_type_text}</td>
                            <td>${el.topic}</td>
                            <td>${el.current_position}</td>
                            <td>${el.offset}</td>
                            <td>${el.max_position}</td>
                            <td>${el.min_position}</td>
                            <td>${el.default_position}</td>
                            <td>${motor_display}</td>
                            <td>
                                <a href="#" id="depends-a-${el.id}-${el.motor_id}">${depend}</a>
                                <input type="file" name="depends-upload-${el.id}-${el.motor_id}" id="depends-upload-${el.id}-${el.motor_id}" style="display: none;" motor_id="${el.motor_id}" />
                            </td>
                            <td style="padding:0;">
                                ${el.master_id !== null && el.master_id !== undefined && !el.is_master ? '' :
                                `<button class="table_operation_btn" data-control-modify-id="${el.id}">改</button>
                                 <button class="table_operation_btn_waring" data-control-delete-id="${el.id}" motor_id="${el.motor_id}" data-is-master="${el.is_master}">删</button>`}
                            </td>
                        </tr>`);
                });
                },
            error: function(xhr, status, error) { // 请求失败时的回调函数
            console.error(error); // 在控制台打印错误信息
            }
        })
    }

    function part_id(topic){
        // ROS topic 含 / 等特殊字符，不能直接用作 CSS id
        return 'part_' + String(topic).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function refresh_control_center_page(){
        while (control_page.firstChild) {
            control_page.removeChild(control_page.firstChild);
        }
        $.ajax({
            type:"get",
            url:"/control/get_all",
            data:{"robot_id": current_robot_id},
            success: function(response) { // 请求成功时的回调函数
                    response.topic.forEach((data,index)=>{
                        let control_bar=""
                        $(`#control_center`).append(
                            `<div class="contorl-card" id="${part_id(data)}">
                                <div class="card_title" style="display:flex;flex-direction:row;justify-content: space-between;">
                                    <div>
                                        <label for="location_all_select_${part_id(data)}">${response.part_names[index]}</label><input type="checkbox" id="location_all_select_${part_id(data)}" class="location_all_select"/>
                                    </div>
                                    <div style="font-size: initial;display: flex;gap: 60px;padding-top: 30px;">
                                        <span>位置</span>
                                        <span>速度</span>
                                        <span>电流</span>
                                    </div>
                                </div>
                                <hr style="margin-top:0">
                            </div>`
                        )
                    });
                    // 分组：独立 vs 协同
                    var groups = {};  // { master_id: { master: obj, slaves: [] } }
                    var independent = [];
                    response.motors.forEach(function(d) {
                        if (d.slave_id === null || d.slave_id === undefined) {
                            independent.push(d);
                        } else if (d.slave_id === d.id) {
                            // 主节点
                            if (!groups[d.slave_id]) groups[d.slave_id] = { master: d, slaves: [] };
                            else groups[d.slave_id].master = d;
                        } else {
                            // 从节点
                            if (!groups[d.slave_id]) groups[d.slave_id] = { master: null, slaves: [] };
                            groups[d.slave_id].slaves.push(d);
                        }
                    });

                    function render_motor_bar(d, extra_class) {
                        return `<div class="form-group card_body ${extra_class || ''}">
                            <a href="#" class="spinner-border text-success controller_running" role="status" id="control_bar_loading_${d.id}" style="display: none;width:1.5rem;height:1.5rem;" data=${d.id}>
                                <span class="sr-only">Loading...</span>
                            </a>
                            <input type="checkbox" style="width:3%" id="control-checkbox-${d.name_index}" canid="${d.topic}" module="${d.topic}" name_index="${d.name_index}" data-default="${d.default_position}">
                            <label for="control-checkbox-${d.name_index}">${d.name}(${d.current_position}):</label>
                            <input type="range" class="form-control-range" id="control-${d.name_index}" min="${d.min}" max="${d.max}" value="${d.current_position}" step="0.001" canid="${d.topic}" module="${d.topic}" name_index="${d.name_index}" title=""/>
                            <input type="number" class="control-position-input" style="width:10%" value="${d.current_position}" id="control-position-${d.name_index}" autocomplete="off" step="0.01"  canid="${d.topic}"  module="${d.topic}" name_index="${d.name_index}"
                                oninput="if(value>${d.max})value=${d.max};if(value<${d.min}) value=${d.min}" title=""/>
                            <input type="number" style="width:10%" value="${default_speed}" id="control-speed-${d.name_index}" min="0" autocomplete="off" step="0.1"/>
                            <input type="number" style="width:10%" value="${default_current}" id="control-current-${d.name_index}" min="0" autocomplete="off" step="0.1"/>
                        </div>`;
                    }

                    // 渲染独立电机
                    independent.forEach(function(d) {
                        $(`#${part_id(d.topic)}`).append(render_motor_bar(d, ''));
                    });

                    // 渲染协同组
                    for (var gid in groups) {
                        var g = groups[gid];
                        var master_topic = g.master ? g.master.topic : (g.slaves.length > 0 ? g.slaves[0].topic : '');
                        if (!master_topic) continue;
                        // 主节点：正常 motor bar（合成 name_index）
                        if (g.master) {
                            g.master.name_index = 'master_' + gid;
                            if (!g.master.min && g.master.min !== 0) g.master.min = -1;
                            if (!g.master.max && g.master.max !== 0) g.master.max = 1;
                            $(`#${part_id(master_topic)}`).append(render_motor_bar(g.master, ''));
                        }
                        // 从节点：缩小 + 缩进
                        g.slaves.forEach(function(slave) {
                            $(`#${part_id(slave.topic)}`).append(render_motor_bar(slave, 'coordinated-slave-bar'));
                        });
                    }

                    // 主节点 checkbox 联动所有从节点
                    for (var gid in groups) {
                        (function(g, masterId) {
                            $(document).off('change', '#control-checkbox-master_' + masterId).on('change', '#control-checkbox-master_' + masterId, function() {
                                var checked = $(this).prop('checked');
                                g.slaves.forEach(function(s) {
                                    $(`#control-checkbox-${s.name_index}`).prop('checked', checked);
                                });
                            });
                            // 主节点滑块变化时调 API 计算从节点值（防抖 150ms）
                            var compute_timer = null;
                            function compute_slaves(x_val) {
                                if (!g.slaves.length) return;
                                clearTimeout(compute_timer);
                                compute_timer = setTimeout(function() {
                                    var slave_ids = g.slaves.map(function(s) { return s.id; }).join(',');
                                    $.ajax({
                                        type: 'post',
                                        url: '/controller/compute_slaves',
                                        data: { master_value: x_val, slave_ids: slave_ids },
                                        success: function(res) {
                                            for (var sid in res.results) {
                                                var r = res.results[sid];
                                                $(`#control-${r.name_index}`).val(r.value);
                                                $(`#control-position-${r.name_index}`).val(r.value);
                                            }
                                        }
                                    });
                                }, 150);
                            }
                            $(document).off('input', '#control-master_' + masterId).on('input', '#control-master_' + masterId, function() {
                                compute_slaves(parseFloat($(this).val()));
                            });
                            $(document).off('input', '#control-position-master_' + masterId).on('input', '#control-position-master_' + masterId, function() {
                                compute_slaves(parseFloat($(this).val()));
                            });
                        })(groups[gid], gid);
                    }
                },
            error: function(xhr, status, error) { // 请求失败时的回调函数
            console.error(error); // 在控制台打印错误信息
            }
        })
    };

    $(`#robot_type_select`).change(function(){
        refresh_control_center_page()
    })

    function refresh_action_group(){
        const action_groups_cards_box=document.getElementById("action_groups_cards_box")
        // 记住当前展开的卡片
        const expandedGroupId = timelineGroupId;
        while (action_groups_cards_box.firstChild) {
            action_groups_cards_box.removeChild(action_groups_cards_box.firstChild);
        }
        $.ajax({
            type:"get",
            url:"/action_group/get_all",
            data:{"robot_id": current_robot_id},
            success:function(response){
                response.groups.forEach((data,index)=>{
                    action_groups_cards_box.insertAdjacentHTML('beforeend',`
                        <div class="card" id="action-card-${data[0]}">
                            <div class="card-body">
                                <h5 class="card-title">${data[1]}</h5>
                                <p class="card-text">${data[2]}</p>
                                <hr style="margin-bottom:5px;margin-top:5px">
                                <p class="card-text">${data[3]}</p>
                                <a href="#" class="btn btn-primary group_card_streach" data="${data[0]}" style="position: absolute;bottom: 4%;left: 40%;z-index:1">查看</a>
                                <div class="right_card_body_div">
                                    <a href="#" class="btn btn-primary edit btn-sm" data="${data[0]}">编辑</a>
                                    <a href="#" class="btn btn-warning btn-sm" data="${data[0]}">移动</a>
                                    <a href="#" class="btn btn-danger btn-sm" data="${data[0]}">删除</a>
                                </div>
                                <div class="action_tree_box" id="action_tree_box-${data[0]}">
                                </div>
                            </div>
                        </div>
                        `)
                })
                // 仅在时间轴面板展开时恢复卡片状态
                if (expandedGroupId && action_group_details.classList.contains('active')) {
                    const card = document.getElementById('action-card-' + expandedGroupId);
                    if (card) {
                        card.style.height = '100%';
                        const allCards = action_groups_cards_box.querySelectorAll(':has(.card-body)');
                        allCards.forEach(c => { if (c !== card) c.style.display = 'none'; });
                        updateCardActionTree(expandedGroupId, timelineActions);
                    }
                }
            },
            error:function(e){
                alert(e)
            }
        })
    }

    function loading_on(type1,type2){
        $(`#${type1}_${type2}`).css("display","none")
        $(`#${type1}_${type2}_wait`).css("display","block")
    }

    function loading_off(type1,type2){
        $(`#${type1}_${type2}`).css("display","block")
        $(`#${type1}_${type2}_wait`).css("display","none")
    }

    $(`#motor-config-page-btn`).click(function(){
        refresh_motor_page()
    })

    $(`#control-config-page-btn`).click(function(){
        refresh_control_config_page()
    })

    $(`#control-center-page-btn`).click(function(){
        refresh_control_center_page()
    })

    $(`#action-group-page-btn`).click(function(){
        action_group_details.classList.remove('active');
        timelineGroupId = null;
        timelineActions = [];
        clearTimelineDirty();
        refresh_action_group()
    })

    function get_control_form(){
        const control_id_checkbox=$('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        let data=[]
        control_id_checkbox.each(function() {
            const control_id=$(this).attr('id').split("-")[2]
            // 跳过主节点（虚拟节点）
            if (control_id && control_id.startsWith('master_')) {
                return true; // continue to next
            }
            let controller={}
            controller["id"]=control_id
            controller["position"]=parseFloat($(`#control-position-${control_id}`).val())
            controller["speed"]=parseFloat($(`#control-speed-${control_id}`).val())
            controller["type"]=parseInt($(this).attr("control_mode"))
            data.push(controller)
        });
        return data
    }
    
    function standar_get_control_form() {
        const control_id_checkbox = $('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        let commands = [];
        let hasError = false;
        let errorMessage = "";

        control_id_checkbox.each(function() {
            if (hasError) return false; // 如果已经有错误，停止继续处理

            let data = {};
            const motor_id = $(this).attr('id').split("-")[2];

            // 跳过主节点（虚拟节点），主节点的值不应发送到 run/init 请求
            if (motor_id && motor_id.startsWith('master_')) {
                return true; // continue to next
            }

            const part = $(this).attr('module');
            
            // 获取原始输入值
            const valueStr = $(`#control-position-${motor_id}`).val();
            const speedStr = $(`#control-speed-${motor_id}`).val();
            const currentStr = $(`#control-current-${motor_id}`).val();
            
            // 验证 value
            if (!isValidNumber(valueStr)) {
                hasError = true;
                errorMessage = `模块 ${part} (ID: ${motor_id}) 的位置值 "${valueStr}" 不是有效的数字`;
                return false;
            }
            
            // 验证 speed
            if (!isValidNumber(speedStr)) {
                hasError = true;
                errorMessage = `模块 ${part} (ID: ${motor_id}) 的速度值 "${speedStr}" 不是有效的数字`;
                return false;
            }
            
            // 验证 speed 不能为0或负数
            const speed = parseFloat(speedStr);
            if (speed <= 0) {
                hasError = true;
                errorMessage = `模块 ${part} (ID: ${motor_id}) 的速度值必须大于0`;
                return false;
            }

            const current = parseFloat(currentStr);
            if (current <= 0) {
                hasError = true;
                errorMessage = `模块 ${part} (ID: ${motor_id}) 的电流值必须大于0`;
                return false;
            }
            
            // 如果所有验证都通过，则添加到命令列表
            data["name_index"] = parseInt($(this).attr("name_index"));
            data["value"] = parseFloat(valueStr);
            data["speed"] = speed;
            data["part"] = part;
            data["current"]=current
            
            commands.push(data);
        });
        
        // 如果有错误，显示弹窗并返回空数组
        if (hasError) {
            showErrorAlert(errorMessage);
            return [];
        }
        
        return commands;
    }

    // 验证是否为有效数字的函数
    function isValidNumber(str) {
        if (str === "" || str === null || str === undefined) {
            return false;
        }
        
        // 检查是否为数字（包括小数和负数）
        const num = parseFloat(str);
        return !isNaN(num) && isFinite(str);
    }

    // 显示错误弹窗的函数
    function showErrorAlert(message) {
        // 使用浏览器原生alert
        alert("输入错误: " + message);
        
        // 或者使用自定义模态框（如果你有UI框架）
        // 示例：使用Bootstrap模态框
        /*
        $('#errorModal .modal-body').text(message);
        $('#errorModal').modal('show');
        */
        
        // 或者使用SweetAlert2（如果已引入）
        /*
        Swal.fire({
            icon: 'error',
            title: '输入错误',
            text: message,
            confirmButtonText: '确定'
        });
        */
    }

    $("#motor_alignment").click(function (e) { 
        e.preventDefault();
        const control_id_checkbox=$('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        if (control_id_checkbox.length==0){
            alert("请选择控制对象")
            return 
        }
        const ids=[]
        control_id_checkbox.each(function(){
            ids.push(parseInt($(this).attr("id").split("-")[2]))
        })
        console.log(ids)
        $.ajax({
            type: "post",
            url: "/control/align",
            contentType: "application/x-www-form-urlencoded; charset=UTF-8",
            traditional: true, // 重要：用于正确序列化数组参数
            data: {"control_ids":ids},
            success: function (response) {
                console.log(response.message)
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
                console.log(error); // 在控制台打印错误信息
            }
        });
    });

    $(`#run`).click(function(){
        const control_id_checkbox=$('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        if (control_id_checkbox.length==0){
            alert("请选择控制对象")
            return 
        }
        const commands=standar_get_control_form()
        if(commands==false){
            return
        }
        $.ajax({
            type:"post",
            url:"/control/run",
            contentType: "application/json",
            data: JSON.stringify(commands), // 序列化处理后的数据
            dataType: "json",
            success: function(response) { // 请求成功时的回调函数
                // refresh_control_center_page()
                if(response.message!=="success"){
                    alert(response.message)
                }
                console.log(response.message)
            },
            error: function(xhr, status, error) { // 请求失败时的回调函数
            console.log(error); // 在控制台打印错误信息
            }
        }) 
    })

    $(`#control_init`).click(function(){
        const control_id_checkbox=$('input[type="checkbox"][id^="control-checkbox-"]').filter(':checked');
        if (control_id_checkbox.length==0){
            alert("请选择控制对象")
            return
        }
        const commands=standar_get_control_form()
        if (commands===false) return
        $.ajax({
            type:"post",
            url:"/control/init",
            contentType: "application/json",
            data: JSON.stringify(commands),
            success: function(response) {
                console.log(response.message)
                // 前端归零
                control_id_checkbox.each(function(){
                    const motor_id=$(this).attr('id').split("-")[2]
                    const def_pos=$(this).attr('data-default')||0
                    $(`#control-position-${motor_id}`).val(def_pos)
                    $(`#control-${motor_id}`).val(def_pos)
                })
            },
            error: function(xhr, status, error) {
            console.error(error);
            }
        })
    })

    $(`#open_add_action_modal`).click(function(){
        add_actions_window_open()
    })

    $(`#open_action_group_modal`).click(function(){
        add_actions_group_window_open()
    })

    var _pendingTrack = {};  // 缓存每个 group 的下一个轨道号

    $('#add_action_select_group').change(function() {
        var selectedValue = $(this).val();
        $.ajax({
            url: "/action/get_all",
            type: 'GET',
            data: { "group_id": selectedValue },
            success: function(response) {
                const actions = (response.timeline && response.timeline.actions) ? response.timeline.actions : (response.action || []);
                // 计算下一个轨道号
                let maxTrack = 0;
                actions.forEach(function (a) {
                    const t = a.track || (a[3] || 1);  // 兼容新旧格式
                    if (t > maxTrack) maxTrack = t;
                });
                _pendingTrack[selectedValue] = maxTrack + 1;
                // start_time 默认 0
                $('#add_action_seq').val(0);
            },
            error: function(xhr, status, error) {
                console.error('AJAX Error:', status, error);
            }
        });
    });

    // add_action 和 modify_action 已迁移到时间轴 UI 控件部分（文件末尾）

    $(`#stop_action_group`).click(function(){
        stopPlayhead();
        $.ajax({
            type: "post",
            url: "/action_group/stop",
            success: function () {}
        });
    })

    $(`#add_action_group`).click(function(){
        const formdata=get_add_action_group_form('add')
        $.ajax({
            type:"post",
            url:"/action_group/add",
            data:formdata,
            success:function(response){
                if(response.message){
                    alert("success")
                    $('#add-action-group-modal').css('display', 'none');
                    add_actions_window_open()
                }
            },
            error:function(e){
                alert(e)
            }
        })
    })

    function let_other_card_die(container,card){
        const allCards = container.querySelectorAll(':has(.card-body)');
        allCards.forEach(otherCard => {
            if (otherCard !== card) {
                otherCard.style.display="none"
            }
        });
    }

    // ==================== 时间轴渲染 ====================
    let timelinePixelsPerSecond = 80;
    let timelineActions = [];
    let timelineGroupId = null;
    let timelinePlayheadAnim = null;
    let timelineDirty = false;
    let playStartTime = 0;  // 播放起始点（秒）

    function markTimelineDirty() {
        if (timelineDirty) return;
        timelineDirty = true;
        $('#timeline-dirty-badge').show();
        $('#timeline_save_btn').prop('disabled', false);
    }

    function clearTimelineDirty() {
        timelineDirty = false;
        $('#timeline-dirty-badge').hide();
        $('#timeline_save_btn').prop('disabled', true);
    }

    function renderTimeline(group_id) {
        // 如果有未保存的修改且要切换到不同组，提示用户
        if (timelineDirty && timelineGroupId && timelineGroupId !== group_id) {
            if (!confirm('当前动作组有未保存的修改，切换将丢失改动。确定切换？')) {
                return;
            }
        }
        action_group_details.classList.add('active');
        clearTimelineDirty();
        playStartTime = 0;
        updatePlayMarker();
        timelineGroupId = group_id;
        $.ajax({
            type: "get",
            url: "/action/get_all",
            data: { "group_id": parseInt(group_id) },
            cache: false,
            success: function (response) {
                if (!response || !response.timeline) return;
                timelineActions = response.timeline.actions || [];
                // 本地重算 duration（基于前序位置）
                recalcDurations();
                const totalDuration = Math.max(
                    timelineActions.reduce((m, a) => Math.max(m, (a.start_time || 0) + (a.duration || 2)), 0),
                    10
                );
                // 更新标题
                if (response.group) {
                    $('#action-group-name').attr('data', response.group[0]);
                    $('#action-group-name').text(response.group[1]);
                }
                $('#run_action_group,#stop_action_group').attr('data', group_id);
                renderRuler(totalDuration);
                renderTracksAndBlocks(totalDuration);
                // 重置播放头
                $('#timeline_playhead').css({ left: '70px', display: 'none' }).removeClass('visible');
                if (timelinePlayheadAnim) {
                    cancelAnimationFrame(timelinePlayheadAnim);
                    timelinePlayheadAnim = null;
                }
                // 更新左侧卡片中的动作树
                updateCardActionTree(group_id, timelineActions);
            },
            error: function (e) { console.error(e); }
        });
    }

    const SNAP_THRESHOLD = 0.5;  // 吸附阈值（秒）

    function snapToSiblingEnd(actionId, proposedStartTime) {
        // 跨所有轨道查找最近的兄弟末尾 + 0s 位置
        const siblings = timelineActions.filter(a => a.id !== actionId);
        let bestSnap = null;
        // 0s 也作为吸附点
        if (Math.abs(proposedStartTime - 0) <= SNAP_THRESHOLD) bestSnap = 0;
        siblings.forEach(function (s) {
            const sEnd = (s.start_time || 0) + (s.duration || 2);
            if (sEnd <= proposedStartTime + SNAP_THRESHOLD) {
                if (bestSnap === null || sEnd > bestSnap) bestSnap = sEnd;
            }
        });
        if (bestSnap !== null && Math.abs(proposedStartTime - bestSnap) <= SNAP_THRESHOLD) {
            return bestSnap;
        }
        return null;
    }

    function avoidOverlap(actionId, targetTrack, proposedStartTime, duration) {
        // 同轨道内禁止重叠：如果与任何兄弟重叠，推到其末尾
        const siblings = timelineActions.filter(a => a.id !== actionId && (a.track || 1) === targetTrack);
        let adjusted = proposedStartTime;
        let changed = true;
        // 循环解决可能被推后仍重叠的情况（最多迭代 10 次防止死循环）
        for (let iter = 0; iter < 10 && changed; iter++) {
            changed = false;
            for (const s of siblings) {
                const sStart = s.start_time || 0;
                const sEnd = sStart + (s.duration || 2);
                const adjEnd = adjusted + duration;
                // 检查重叠：不是完全在左边或完全在右边
                if (adjusted < sEnd && adjEnd > sStart) {
                    adjusted = sEnd;
                    changed = true;
                }
            }
        }
        return Math.max(0, Math.round(adjusted * 10) / 10);
    }

    // 全局 dragover：实时吸附引导线
    $('#timeline_tracks').on('dragover', function (e) {
        e.preventDefault();
        const actionId = window._draggingActionId;
        if (!actionId) return;
        const dragAction = timelineActions.find(a => a.id === actionId);
        if (!dragAction) return;

        const container = document.getElementById('timeline_container');
        const tracksEl = document.getElementById('timeline_tracks');
        const tracksRect = tracksEl.getBoundingClientRect();

        // 确定目标轨道
        let targetTrack = dragAction.track || 1;
        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        if (elemBelow) {
            const trackContent = elemBelow.closest('.timeline-content');
            if (trackContent) targetTrack = parseInt(trackContent.getAttribute('data-track'));
            else {
                const trackEl = elemBelow.closest('.timeline-track');
                if (trackEl) targetTrack = parseInt(trackEl.getAttribute('data-track'));
            }
        }

        const offsetX = window._dragOffsetX || 0;
        const blockLeftX = e.clientX - offsetX - tracksRect.left - 70;
        const proposedTime = Math.max(0, Math.round(Math.max(0, blockLeftX) / timelinePixelsPerSecond * 10) / 10);
        let finalTime = proposedTime;
        const snapped = snapToSiblingEnd(actionId, proposedTime);
        if (snapped !== null) finalTime = snapped;
        finalTime = avoidOverlap(actionId, targetTrack, finalTime, dragAction.duration || 2);

        if (finalTime !== proposedTime || snapped !== null) {
            const lineX = 70 + finalTime * timelinePixelsPerSecond;
            $('#timeline_snap_line').css({ left: lineX + 'px' }).addClass('visible');
        } else {
            $('#timeline_snap_line').removeClass('visible');
        }
    });

    $('#timeline_tracks').on('dragleave', function (e) {
        // 只在真正离开 tracks 区域时隐藏
        if (!this.contains(e.relatedTarget)) {
            $('#timeline_snap_line').removeClass('visible');
        }
    });

    function recalcDurations() {
        // 按 start_time 排序后，基于前序累积位置重算每个动作的 duration
        const sorted = [...timelineActions].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
        const prevPos = {};  // {name_index: value}
        sorted.forEach(function (a) {
            let maxDur = 0.0;
            try {
                var cmd = typeof a.command === 'string' ? JSON.parse(a.command.replace(/'/g, '"').replace(/None/g, 'null')) : a.command;
                for (var part in cmd) {
                    cmd[part].forEach(function (mc) {
                        var ni = String(mc.name_index);
                        var target = parseFloat(mc.value) || 0;
                        var speed = parseFloat(mc.speed) || 1.0;
                        if (speed <= 0) speed = 1.0;
                        var prev = parseFloat(prevPos[ni]) || 0;
                        var d = Math.abs(target - prev) / speed;
                        if (d > maxDur) maxDur = d;
                        prevPos[ni] = parseFloat(mc.value) || 0;
                    });
                }
            } catch (e) {}
            a.duration = Math.round(Math.max(0.5, maxDur) * 100) / 100;
        });
    }

    function rerenderTimelineLocal() {
        recalcDurations();
        const totalDuration = Math.max(
            timelineActions.reduce((m, a) => Math.max(m, (a.start_time || 0) + (a.duration || 2)), 0),
            10
        );
        renderRuler(totalDuration);
        renderTracksAndBlocks(totalDuration);
        if (timelineGroupId) updateCardActionTree(timelineGroupId, timelineActions);
    }

    function renderRuler(totalDuration) {
        const ruler = document.getElementById('timeline_ruler');
        ruler.innerHTML = '';
        const contentWidth = totalDuration * timelinePixelsPerSecond + 200;
        // 标尺内容区（对齐轨道 content 的 margin-left: 70px）
        const inner = document.createElement('div');
        inner.style.cssText = 'position:relative;width:' + contentWidth + 'px;margin-left:70px;height:100%;';
        const step = totalDuration <= 10 ? 1 : totalDuration <= 30 ? 2 : totalDuration <= 60 ? 5 : 10;
        for (let t = 0; t <= totalDuration; t += step) {
            const x = t * timelinePixelsPerSecond;
            const tick = document.createElement('div');
            tick.className = 'timeline-ruler-tick';
            tick.style.left = x + 'px';
            inner.appendChild(tick);
            const label = document.createElement('div');
            label.className = 'timeline-ruler-label';
            label.style.left = x + 'px';
            label.textContent = t + 's';
            inner.appendChild(label);
        }
        ruler.appendChild(inner);

        // 点击标尺设置播放起始点（不吸附，精确放置）
        inner.addEventListener('click', function (e) {
            const rect = inner.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            playStartTime = Math.max(0, Math.round(clickX / timelinePixelsPerSecond * 10) / 10);
            updatePlayMarker();
        });

        document.getElementById('timeline_container').scrollLeft = 0;
    }

    function updatePlayMarker() {
        let marker = document.getElementById('play_start_marker');
        if (!marker) {
            marker = document.createElement('div');
            marker.id = 'play_start_marker';
            marker.style.cssText = 'position:absolute;top:0;width:12px;height:14px;border-left:6px solid transparent;border-right:6px solid transparent;border-top:12px solid #ef4444;z-index:25;cursor:grab;transition:filter 0.15s;';
            marker.addEventListener('mouseenter', function () { this.style.filter = 'drop-shadow(0 0 4px rgba(239,68,68,0.6))'; });
            marker.addEventListener('mouseleave', function () { this.style.filter = ''; });
            document.getElementById('timeline_ruler').appendChild(marker);
            // 拖拽断点
            let dragging = false;
            marker.addEventListener('mousedown', function (e) {
                e.stopPropagation();
                dragging = true;
                marker.style.cursor = 'grabbing';
            });
            document.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                const ruler = document.getElementById('timeline_ruler');
                const inner = ruler.querySelector('div');
                if (!inner) return;
                const rect = inner.getBoundingClientRect();
                const clickTime = Math.max(0, (e.clientX - rect.left) / timelinePixelsPerSecond);
                // 吸附到动作结束时间 + 0s
                let bestTime = clickTime;
                let bestDist = Math.abs(clickTime - 0);
                bestTime = bestDist <= 0.5 ? 0 : clickTime;
                timelineActions.forEach(function (a) {
                    const et = (a.start_time || 0) + (a.duration || 2);
                    const d = Math.abs(clickTime - et);
                    if (d < bestDist) { bestDist = d; bestTime = et; }
                });
                playStartTime = bestDist <= 0.5 ? bestTime : Math.round(clickTime * 10) / 10;
                marker.style.left = (70 + playStartTime * timelinePixelsPerSecond - 6) + 'px';
                marker.title = '从 ' + playStartTime + 's 开始播放';
            });
            document.addEventListener('mouseup', function () {
                if (dragging) {
                    dragging = false;
                    marker.style.cursor = 'grab';
                }
            });
        }
        if (playStartTime > 0) {
            marker.style.display = 'block';
            marker.style.left = (70 + playStartTime * timelinePixelsPerSecond - 6) + 'px';
            marker.title = '从 ' + playStartTime + 's 开始播放';
        } else {
            marker.style.display = 'none';
        }
    }

    function renderTracksAndBlocks(totalDuration) {
        const tracksContainer = document.getElementById('timeline_tracks');
        tracksContainer.innerHTML = '';
        const contentWidth = totalDuration * timelinePixelsPerSecond + 200;
        tracksContainer.style.width = contentWidth + 'px';

        // 收集所有用到的轨道编号
        const trackSet = new Set();
        timelineActions.forEach(a => trackSet.add(a.track || 1));
        if (trackSet.size === 0) trackSet.add(1);
        const trackIds = [...trackSet].sort((a, b) => a - b);
        // 底部加一个空白占位轨道作为拖放目标
        const maxTrack = trackIds.length > 0 ? trackIds[trackIds.length - 1] : 0;
        const allTrackIds = [...trackIds, maxTrack + 1];

        allTrackIds.forEach(trackId => {
            const isEmptyTrack = trackId > maxTrack;
            const trackEl = document.createElement('div');
            trackEl.className = 'timeline-track';
            if (isEmptyTrack) trackEl.classList.add('timeline-track-ghost');
            trackEl.setAttribute('data-track', trackId);
            trackEl.style.width = (contentWidth - 70) + 'px';

            const label = document.createElement('div');
            label.className = 'timeline-track-label';
            label.textContent = isEmptyTrack ? '+ 拖到此处新建轨道' : '轨道 ' + trackId;
            trackEl.appendChild(label);

            const content = document.createElement('div');
            content.className = 'timeline-content';
            content.style.width = (contentWidth - 70) + 'px';
            content.setAttribute('data-track', trackId);

            // 渲染该轨道上的动作块
            const trackActions = timelineActions.filter(a => (a.track || 1) === trackId);
            trackActions.forEach(action => {
                const block = createActionBlock(action);
                content.appendChild(block);
            });

            // 拖拽悬停高亮（视觉反馈）
            content.addEventListener('dragover', function (e) {
                e.preventDefault();
                this.closest('.timeline-track').classList.add('drag-over');
            });
            content.addEventListener('dragleave', function (e) {
                this.closest('.timeline-track').classList.remove('drag-over');
            });
            content.addEventListener('drop', function (e) {
                e.preventDefault();
                this.closest('.timeline-track').classList.remove('drag-over');
                // 实际位置更新由 block 的 dragend 处理
            });

            // 轨道空白处右键 → 粘贴（绑在 trackEl 上覆盖整行）
            trackEl.addEventListener('contextmenu', function (ev) {
                // 不拦截 block 上的右键
                if ($(ev.target).closest('.timeline-block').length) return;
                ev.preventDefault();
                ev.stopPropagation();
                $('.timeline-context-menu').remove();
                const menu = $('<div class="timeline-context-menu"></div>');
                const pasteItem = $('<div class="timeline-context-menu-item">📄 粘贴到此处</div>').appendTo(menu).click(function () {
                    menu.remove();
                    if (!window._copiedAction) { alert('没有复制的动作'); return; }
                    const ca = window._copiedAction;
                    const newId = -Date.now();
                    const rect = content.getBoundingClientRect();
                    const clickX = ev.clientX - rect.left + content.scrollLeft;
                    const st = Math.max(0, Math.round(clickX / timelinePixelsPerSecond * 10) / 10);
                    timelineActions.push({
                        id: newId,
                        name: ca.name + '(副本)',
                        track: parseInt(trackId),
                        command: ca.command,
                        start_time: st,
                        duration: ca.duration
                    });
                    markTimelineDirty();
                    rerenderTimelineLocal();
                });
                if (!window._copiedAction) pasteItem.addClass('timeline-context-menu-item--disabled');
                menu.css({ left: ev.clientX + 'px', top: ev.clientY + 'px' });
                $('body').append(menu);
                const mr = menu[0].getBoundingClientRect();
                if (mr.right > window.innerWidth) menu.css({ left: (ev.clientX - mr.width) + 'px', top: ev.clientY + 'px' });
                if (mr.bottom > window.innerHeight) menu.css({ left: menu.css('left'), top: (ev.clientY - mr.height) + 'px' });
            });

            trackEl.appendChild(content);
            tracksContainer.appendChild(trackEl);
        });
    }

    function createActionBlock(action) {
        const block = document.createElement('div');
        block.className = 'timeline-block';
        block.setAttribute('data-action-id', action.id);
        block.setAttribute('data-track', action.track || 1);
        block.draggable = true;
        block.style.left = (action.start_time * timelinePixelsPerSecond) + 'px';
        block.style.width = Math.max(60, action.duration * timelinePixelsPerSecond) + 'px';

        // 名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'block-name';
        nameSpan.textContent = action.name;
        block.appendChild(nameSpan);

        // 时长标签
        const durSpan = document.createElement('span');
        durSpan.className = 'block-duration';
        durSpan.textContent = action.duration + 's';
        block.appendChild(durSpan);

        // 右侧拖拽调整时长手柄
        const handle = document.createElement('div');
        handle.className = 'block-resize-handle';
        block.appendChild(handle);

        // 拖拽事件
        let dragOffsetX = 0;
        block.addEventListener('dragstart', function (e) {
            this.classList.add('dragging');
            const blockRect = this.getBoundingClientRect();
            dragOffsetX = e.clientX - blockRect.left;
            window._dragOffsetX = dragOffsetX;
            e.dataTransfer.setData('text/plain', action.id.toString());
            e.dataTransfer.effectAllowed = 'move';
            window._draggingActionId = action.id;
        });
        block.addEventListener('dragend', function (e) {
            this.classList.remove('dragging');
            window._draggingActionId = null;
            $('#timeline_snap_line').removeClass('visible');

            const tracksEl = document.getElementById('timeline_tracks');
            const container = document.getElementById('timeline_container');
            const tracksRect = tracksEl.getBoundingClientRect();

            let targetTrack = parseInt(this.getAttribute('data-track'));
            const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
            if (elemBelow) {
                const trackContent = elemBelow.closest('.timeline-content');
                if (trackContent) {
                    targetTrack = parseInt(trackContent.getAttribute('data-track'));
                } else {
                    const trackEl = elemBelow.closest('.timeline-track');
                    if (trackEl) {
                        targetTrack = parseInt(trackEl.getAttribute('data-track'));
                    } else {
                        // 不在任何轨道上 → 拖到了最下方空白区域 → 新建轨道
                        const maxTrack = timelineActions.reduce((m, a) => Math.max(m, a.track || 1), 0);
                        targetTrack = maxTrack + 1;
                    }
                }
            }

            const blockLeftX = e.clientX - dragOffsetX - tracksRect.left - 70;
            let newStartTime = Math.max(0, Math.round(Math.max(0, blockLeftX) / timelinePixelsPerSecond * 10) / 10);

            // 吸附（跨轨道）
            const snapped = snapToSiblingEnd(action.id, newStartTime);
            if (snapped !== null) newStartTime = snapped;
            // 同轨道不重叠
            newStartTime = avoidOverlap(action.id, targetTrack, newStartTime, action.duration || 2);

            updateActionPosition(action.id, targetTrack, newStartTime);
        });

        // 双击执行
        block.addEventListener('dblclick', function () {
            try {
                const cmd = typeof action.command === 'string'
                    ? JSON.parse(action.command.replace(/'/g, '"').replace(/None/g, 'null'))
                    : action.command;
                action_run(cmd);
            } catch (err) {
                alert('执行失败：' + err.message);
            }
        });

        // 右键菜单
        block.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            // 先移除已有的菜单
            $('.timeline-context-menu').remove();
            const menu = $('<div class="timeline-context-menu"></div>');
            // 执行
            $('<div class="timeline-context-menu-item">▶ 执行</div>').appendTo(menu).click(function () {
                menu.remove();
                try {
                    const cmd = typeof action.command === 'string'
                        ? JSON.parse(action.command.replace(/'/g, '"').replace(/None/g, 'null'))
                        : action.command;
                    action_run(cmd);
                } catch (err) {
                    alert('执行失败：' + err.message);
                }
            });
            // 修改
            $('<div class="timeline-context-menu-item">✎ 修改</div>').appendTo(menu).click(function () {
                menu.remove();
                openModifyActionModal(action.id);
            });
            $('<div class="timeline-context-menu-divider"></div>').appendTo(menu);
            // 复制
            $('<div class="timeline-context-menu-item">📋 复制</div>').appendTo(menu).click(function () {
                menu.remove();
                window._copiedAction = {
                    name: action.name,
                    command: typeof action.command === 'string' ? action.command : JSON.stringify(action.command),
                    duration: action.duration || 2.0
                };
            });
            // 粘贴
            const pasteItem = $('<div class="timeline-context-menu-item">📄 粘贴</div>').appendTo(menu).click(function () {
                menu.remove();
                if (!window._copiedAction) { alert('没有复制的动作'); return; }
                const ca = window._copiedAction;
                const newId = -Date.now();
                const maxStart = timelineActions.reduce((m, a) => Math.max(m, (a.start_time || 0) + (a.duration || 2)), 0);
                timelineActions.push({
                    id: newId,
                    name: ca.name + '(副本)',
                    track: action.track || 1,
                    command: ca.command,
                    start_time: maxStart,
                    duration: ca.duration
                });
                markTimelineDirty();
                rerenderTimelineLocal();
            });
            if (!window._copiedAction) pasteItem.addClass('timeline-context-menu-item--disabled');
            $('<div class="timeline-context-menu-divider"></div>').appendTo(menu);
            // 删除
            $('<div class="timeline-context-menu-item timeline-context-menu-item--danger">✕ 删除</div>').appendTo(menu).click(function () {
                menu.remove();
                deleteActionOnTimeline(action.id);
            });
            // 定位
            menu.css({ left: e.clientX + 'px', top: e.clientY + 'px' });
            $('body').append(menu);
            // 边缘检测，避免溢出窗口
            const mr = menu[0].getBoundingClientRect();
            if (mr.right > window.innerWidth) menu.css({ left: (e.clientX - mr.width) + 'px', top: e.clientY + 'px' });
            if (mr.bottom > window.innerHeight) menu.css({ left: menu.css('left'), top: (e.clientY - mr.height) + 'px' });
        });

        // 拖拽调整时长
        let resizeStartX, resizeStartWidth, resizeActionId;
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            resizeStartX = e.clientX;
            resizeStartWidth = block.offsetWidth;
            resizeActionId = action.id;
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });

        return block;
    }

    // 时长调整的全局事件
    function onResizeMove(e) {
        const delta = e.clientX - resizeStartX;
        const newWidth = Math.max(36, resizeStartWidth + delta);
        const block = document.querySelector(`.timeline-block[data-action-id="${resizeActionId}"]`);
        if (block) block.style.width = newWidth + 'px';
    }
    function onResizeUp(e) {
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeUp);
        const newDuration = Math.max(0.5, Math.round(resizeStartWidth / timelinePixelsPerSecond * 10) / 10);
        const action = timelineActions.find(a => a.id === resizeActionId);
        if (action) { action.duration = newDuration; }
        markTimelineDirty();
        rerenderTimelineLocal();
    }

    function updateActionPosition(actionId, track, startTime) {
        // 仅更新本地数据
        const action = timelineActions.find(a => a.id === actionId);
        if (action) {
            action.track = track;
            action.start_time = startTime;
        }
        markTimelineDirty();
        rerenderTimelineLocal();
    }

    function deleteActionOnTimeline(actionId) {
        // 仅从本地数据中移除
        timelineActions = timelineActions.filter(a => a.id !== actionId);
        markTimelineDirty();
        rerenderTimelineLocal();
    }

    function updateCardActionTree(groupId, actions) {
        const treeBox = document.getElementById('action_tree_box-' + groupId);
        if (!treeBox) return;
        treeBox.innerHTML = '';
        actions.forEach((action, index) => {
            const tree = document.createElement('div');
            tree.className = 'tree';
            tree.setAttribute('data', action.id);
            tree.innerHTML = `
                <div class="circle">${index + 1}</div>
                <div class="action_name_statu">${action.name}</div>
                <div class="action_gap_time_statu">
                    <span style="font-size:11px;color:#888;">${action.start_time}s / ${action.duration}s</span>
                </div>`;
            treeBox.appendChild(tree);
        });
    }

    // ==================== 时间轴执行（带播放头动画） ====================

    function stopPlayhead() {
        if (timelinePlayheadAnim) {
            cancelAnimationFrame(timelinePlayheadAnim);
            timelinePlayheadAnim = null;
        }
        const ph = document.getElementById('timeline_playhead');
        if (ph) { ph.classList.remove('visible'); ph.style.display = 'none'; }
        $('.timeline-block').removeClass('executing');
    }

    function action_group_run() {
        if (!timelineGroupId || timelineActions.length === 0) return;
        stopPlayhead();
        const cycle = $('#action_group_circulate').is(':checked');
        const startFrom = playStartTime || 0;
        const maxEnd = timelineActions.reduce((m, a) => Math.max(m, (a.start_time || 0) + (a.duration || 2)), 0);
        const totalDuration = Math.max(maxEnd, 2);
        const playhead = document.getElementById('timeline_playhead');
        const container = document.getElementById('timeline_container');

        $.ajax({
            type: 'POST',
            url: '/action_group/run',
            contentType: 'application/json',
            data: JSON.stringify({ group_id: timelineGroupId, cycle: cycle, start_from: startFrom }),
            success: function () { stopPlayhead(); },
            error: function () { stopPlayhead(); }
        });

        let startWall = performance.now();
        playhead.classList.add('visible');
        playhead.style.display = 'block';

        function animatePlayhead(now) {
            const elapsed = startFrom + (now - startWall) / 1000;
            if (elapsed >= totalDuration) {
                if (cycle) {
                    startWall = performance.now();
                    timelinePlayheadAnim = requestAnimationFrame(animatePlayhead);
                } else {
                    stopPlayhead();
                }
                return;
            }
            const x = 70 + elapsed * timelinePixelsPerSecond;
            playhead.style.left = x + 'px';
            container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
            $('.timeline-block').removeClass('executing');
            timelineActions.forEach(a => {
                if (elapsed >= a.start_time && elapsed < a.start_time + a.duration) {
                    $(`.timeline-block[data-action-id="${a.id}"]`).addClass('executing');
                }
            });
            timelinePlayheadAnim = requestAnimationFrame(animatePlayhead);
        }
        timelinePlayheadAnim = requestAnimationFrame(animatePlayhead);
    }
    function group_detail_off(){
        action_group_details.classList.remove('active');
        clearTimelineDirty();
        playStartTime = 0;
        updatePlayMarker();
    }

    document.querySelectorAll('#action_groups_cards_box').forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('group_card_streach')) {
                const card=event.target.closest(':has(.card-body)')
                if(card.style.height==="100%"){
                    card.style.height='28.5%';
                    action_group_details.classList.remove('active')
                    setTimeout(() => {
                        refresh_action_group()
                    }, card_strech_time); 
                }
                else{
                    renderTimeline(event.target.getAttribute("data"))
                    card.style.height='100%';
                    let_other_card_die(container,card)
                }
            }
        });
    });

    $(`#modify_action_group`).click(function(){
        const formdata=get_add_action_group_form('modify')
        formdata.group_id=$(`#modify_action_group`).attr("data")
        console.log(formdata)
        $.ajax({
            type:"put",
            url:"/action_group/modify",
            data:formdata,
            success:function(response){
                alert(response.message)
                if(response.message){
                    $('#modify-action-group-modal').css('display', 'none');
                    refresh_action_group()
                    group_detail_off()
                }
            },
            error:function(e){
                alert(e)
            }
        })
    })

    function action_run(command){
        console.log(command)
        $.ajax({
            url: "/action/run",
            method: "post",
            contentType: "application/json",
            data: JSON.stringify(command), // 序列化处理后的数据
            dataType: "json",
            success: function(response) {
            //   alert("发送成功：" + JSON.stringify(response));
            },
            error: function(xhr) {
              const errorMsg = "错误: " + xhr.status + " - " + xhr.responseText;
              console.error(errorMsg);
            //   alert(errorMsg);
            }
          });
    }

    function moveInnerCircle(x, y,z) {
        const innerCircle = document.getElementById('innerCircle');
        const circle_direction=document.getElementById('inner-circle-direction')
        let offsetX = -50;
        let offsetY = -50;
        offsetX += 0.2777*x;
        offsetY += 0.2777*y;
        console.log(`偏移(${offsetX}%,${offsetY}%)`)
        innerCircle.style.transform = "translate(" + offsetX + "%," + offsetY + "%)";
        circle_direction.style.transform=`rotate(-${z}deg)`
        
    }

    $(`#skill-page-btn`).click(function(){
        imu_socket = new WebSocket(`ws://${ip}:8765`);
        imu_socket.onopen = function(event) {
            console.log('WebSocket is open now.');
            $(`#innerCircle`).css("background-color","rgb(63, 197, 146)")
        };

        imu_socket.onmessage = function(event) {
        data=JSON.parse(event.data)
        console.log(data)
        moveInnerCircle(data[0],data[1],data[2])
        };

        imu_socket.onclose = function(event) {
        console.log('WebSocket is closed now.');
        $(`#innerCircle`).css("background-color","rgb(199, 199, 199)")
        };

        imu_socket.onerror = function(error) {
            console.error('WebSocket error:', error);
            $(`#innerCircle`).css("background-color","rgb(199, 199, 199)")
        };
    })

    $(`#menu_options li a`).click(function(){
        if($(this).attr("id")!=="skill-page-btn"){
            if(imu_socket){
                imu_socket.close()
                console.log("imu_socket close test")
            }
        }
        console.log(`redirect to ${$(this).attr("id")}`)
    })

    $(`#run_action_group`).click(function(){
        action_group_run()
    })

    $(`#debug_switch`).change(function(){
        const statu=$(this).is(':checked');
        if(statu){
            $.ajax({
                type: "post",
                url: "/control/debug_on",
                success: function (response) {
                    alert(response.message)
                }
            });
        }
        else{
            $.ajax({
                type: "post",
                url: "/control/debug_off",
                success: function (response) {
                    alert(response.message)
                }
            });
        }
    })

$(`#reset_current`).click(function(){
    const check_boxes = $(`input[type=checkbox][id^="control-checkbox-"]`).filter(':checked');
    let nonArmModules = [];
    let form = {"control_ids": [], "parts": []}
    
    // 首先检查所有选中的复选框
    for (let index = 0; index < check_boxes.length; index++) {
        const checkbox = check_boxes[index];
        const module = $(checkbox).attr('module');
        const control_id = checkbox.id.split("-")[2]; // control_id 是一个字符串，例如 "123"
        
        form["control_ids"].push(parseInt(control_id)); // 推送整数 123
        form["parts"].push(module);                 // <--- 修改这里：直接推送字符串 "123"
    }
    
    $.ajax({
        type: "post",
        url: "/control/reset_current",
        contentType: "application/json",
        data: JSON.stringify(form),
        success: function (response) {
            alert(response.message)
        },
        // 强烈建议添加错误处理，这样可以看到服务器返回的详细错误信息
        error: function(jqXHR, textStatus, errorThrown) {
            console.error("请求失败:", jqXHR.responseText);
            alert("请求失败，请检查控制台获取详细信息。\n" + jqXHR.responseText);
        }
    })
})

    function refresh_rectify_page(){
        const imu_config_table=document.getElementById(`imu_config`)
        while (imu_config_table.firstChild){
            imu_config_table.removeChild(imu_config_table.firstChild)
        }
        $.ajax({
            type: "get",
            url: "/balance/get",
            success: function (response) {
                if(response.message){
                    response.message.imus.forEach(function(data3,index){
                        if(data3[6]===null){
                            data3[6]="未设置"
                        }
                        if(data3[7]===null){
                            data3[7]="未设置"
                        }
                        $(`#imu_config`).append(
                            `<tr id="imu-${data3[0]}">
                                <td>${1+index}</td><td>${data3[1]}</td><td>${data3[2]}</td><td>${data3[3]}</td><td>${data3[4]}</td><td>${data3[5]}</td><td>${data3[6]}</td><td>${data3[7]}</td><td>${data3[9]}</td>
                                <td style="width:15%;">
                                    <button class="table_operation_btn" imu_id="${data3[0]}">编辑</button>
                                    <button class="table_operation_btn_waring" imu_id="${data3[0]}">删除</button>
                                </td>
                            </tr>`
                        )
                    })
                }
            }
        });
    }

    function refresh_imu_form(window_type){
        let form_type=""
        if (window_type==="modify"){
            form_type="modify_"
        }
        const imu_port=document.getElementById(`${form_type}imu_port`)
        const imu_location=document.getElementById(`${form_type}imu_location`)
        const imu_relect_joint=document.getElementById(`${form_type}imu_relect_joint`)
        while (imu_port.children.length>1) {
            imu_port.removeChild(imu_port.children[1]);
        }
        while (imu_location.children.length>1) {
            imu_location.removeChild(imu_location.children[1]);
        }
        while (imu_relect_joint.children.length>1) {
            imu_relect_joint.removeChild(imu_relect_joint.children[1]);
        }
        $.ajax({
            type: "get",
            url: "/balance/get_add_imu_form",
            success: function (response) {
                if(response.message){
                    response.message.port.forEach(function(data1,index){
                        $(`#${form_type}imu_port`).append(`
                                <option value="${data1}">${data1}</option>
                        `)
                    })
                    response.message.location.forEach(function(data2,index){
                        $(`#${form_type}imu_location`).append(`
                                <option value="${data2}">${data2}</option>
                        `)
                    })
                    $(`#${window_type}-imu-modal`).css("display","block")     
                }
            }
        });
    }

    $(`#open_add_imu_window_btn`).click(function(){
        refresh_imu_form("add")
    })

    $(`#rectify-page-btn`).click(function(){
        refresh_rectify_page()
    })

    document.querySelectorAll('#add_imu_form').forEach(container => {
        container.addEventListener('change', (event) => {
            if (event.target && event.target.id==="imu_location") {
                const imu_relect_joint=document.getElementById("imu_relect_joint")
                const imu_config_table=document.getElementById("imu_config")
                while (imu_relect_joint.children.length>1) {
                    imu_relect_joint.removeChild(imu_relect_joint.children[1]);
                }
                const location=$(`#imu_location`).val()
                if(location===""){
                    return
                }
                $.ajax({
                    type: "get",
                    url: "/balance/get_control",
                    data: {"location":String(location)},
                    success: function (response) {
                        if(response.message){
                            console.log(response.message)
                            response.message.forEach(function(data,index){
                                $(`#imu_relect_joint`).append(`
                                    <option value="${data[0]}">${data[1]}</option>  
                                `)
                            })
                        }
                    }
                });
            }
        });
    });

    $(`#imu_add`).click(function(){
        const formData = {
            'imu_port': $('#imu_port').val(),
            'imu_baudrate': $('#imu_baudrate').val(),
            'imu_name': $('#imu_name').val(),
            'imu_standard_value': $('#imu_standard_value').val(),
            'imu_deviation': $('#imu_deviation').val(),
            'imu_axis': $('#imu_axis').val(),
            'imu_location': $('#imu_location').val(),
            'imu_relect_joint': $('#imu_relect_joint').val(),
            'imu_factor':$('#imu_factor').val()
        };
        $.ajax({
            type: 'post',
            url: '/balance/add_imu',
            data: formData,
            success: function(response) {
                if(response.message){
                    refresh_rectify_page()
                }
            },
            error: function(error) {
                console.log('Error:', error);
                // You can add code here to handle an error response from the server
            }
        });
    })
    
    $("[name='rectify']").on("click",function(){
        const bus=$(this).attr("imu_bus")
        const boards_imu=parseInt($(this).attr("boards_imu"))
        $.ajax({
            type: "post",
            url: "/balance/rectify",
            data: {"imu_bus":bus,"boards_imu":boards_imu},
            success: function (response) {
                alert(response.message)
            }
        });
    })

    document.querySelectorAll("#imu_config_box").forEach(container => {
        container.addEventListener('click', (event) => {
            if(event.target && event.target.classList.contains('table_operation_btn_waring')) {
                $.ajax({
                    type: "delete",
                    url: "/balance/imu_delete",
                    data: {"imu_id":parseInt(event.target.getAttribute("imu_id"))},
                    success: function (response) {
                        if(response.message){
                            refresh_rectify_page()
                        }
                    }
                });
            }
            if(event.target && event.target.classList.contains('table_operation_btn')) {
                refresh_imu_form("modify")
                
            }
        })
    })
    
    // 初始化数据存储
    let dataset = {
        x: [],
        y: [],
        z: []
    };

    // 配置参数
    const TIME_WINDOW = 60000; // 60秒时间窗口
    const LINE_COLORS = ['#5470C6', '#91CC75', '#EE6666'];

    const option = {
        title: { text: 'Real-time Gyroscope Data' },
        tooltip: {
            trigger: 'axis',
            formatter: function (params) {
                return params.map(p => {
                    const date = new Date(p.value[0]);
                    return `${p.seriesName}<br/>
                    ${date.toLocaleTimeString()}.${p.value[0] % 1000}<br/>
                    Value: ${p.value[1].toFixed(2)}°/s`
                }).join('<hr/>');
            }
        },
        legend: { data: ['X Axis', 'Y Axis', 'Z Axis'] },
        xAxis: {
            type: 'time',
            axisLabel: {
                formatter: function (value) {
                    const date = new Date(value);
                    return echarts.time.format(date, '{HH}:{mm}:{ss}', false);
                }
            }
        },
        yAxis: {
            name: 'Angular Velocity (°/s)' ,
            min:-180,
            max:180
        },
        series: [
            createSeries('X Axis', LINE_COLORS[0]),
            createSeries('Y Axis', LINE_COLORS[1]),
            createSeries('Z Axis', LINE_COLORS[2])
        ]
    };

    function createSeries(name, color) {
        return {
            name: name,
            type: 'line',
            showSymbol: false,
            lineStyle: { color: color },
            data: []
        };
    }

    // WebSocket连接
    const ws = new WebSocket('ws://localhost:1231');

    ws.onmessage = function (event) {
        const newData = JSON.parse(event.data);
        const now = Date.now();

        // 更新数据集（假设数据格式为[x,y,z]）
        updateDataset('x', now, newData[0]);
        updateDataset('y', now, newData[1]);
        updateDataset('z', now, newData[2]);

        // 动态调整显示范围
        option.xAxis.min = now - TIME_WINDOW;
        option.xAxis.max = now;

        myChart.setOption({
            xAxis: option.xAxis,
            series: [
                { data: dataset.x },
                { data: dataset.y },
                { data: dataset.z }
            ]
        });
    };

    function updateDataset(axis, timestamp, value) {
        // 添加新数据点
        dataset[axis].push([timestamp, value]);
        
        // 清理旧数据（两种方式二选一）
        // 方式1：基于时间窗口
        const cutoff = timestamp - TIME_WINDOW;
        while (dataset[axis].length > 0 && dataset[axis][0][0] < cutoff) {
            dataset[axis].shift();
        }

        // 方式2：基于固定数据长度（注释方式1后启用）
        // if (dataset[axis].length > 500) {
        //     dataset[axis].shift();
        // }
    }

    var chartDom = document.getElementById('IMU_charts');
    if (chartDom){
        var myChart = echarts.init(chartDom);
        myChart.setOption(option);
    }

    document.querySelectorAll('#imu_show').forEach(container => {
        container.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('btn-outline-info')) {
                console.log(event.target.getAttribute("data"))
                // 修改图表标题
                option.title.text = 'Reset Chart - Real-time Gyroscope Data';
                
                // 清空数据集
                dataset.x = [];
                dataset.y = [];
                dataset.z = [];
                
                // 重置时间窗口到当前时刻
                const now = Date.now();
                option.xAxis.min = now - TIME_WINDOW;
                option.xAxis.max = now;
                
                // 强制应用新配置并清空图表
                myChart.setOption(option, { notMerge: true });
            }
        });
    });

    $(`#knowledge-table tr td .table_operation_btn`).click(function(){
        const self = this; // 保存当前按钮的引用
        const modify_box = document.getElementById("modify-knowledge-modal");
        // 首先更新动作组，并在完成后执行后续操作
        update_action_group_knowledge("modify").done(function() {
            // 现在下拉菜单已填充，获取知识详情并设置值
            $.ajax({
                type: "get",
                url: url + "/knowledge/get",
                data: {"knowledge_id": parseInt($(self).attr("data"))},
                success: function (response) {
                    if (response.message) {
                        $(`#modify_answer_type`).val(response.message.type);
                        $(`#modify_question`).val(response.message.question);
                        $(`#modify_answer`).val(response.message.answer);
                        if (response.message.type == 2 && response.message.group_id) {
                            $(`#modify_bind_action_group`).parent().css("display", "flex");
                            $(`#modify_bind_action_group`).val(response.message.group_id);
                        }
                        else{
                            $(`#modify_bind_action_group`).parent().css("display", "none");
                        }
                        modify_box.style.display = "block";
                        $(`#modify_knowledge_submit`).attr("data", response.message.id);
                    }
                }
            });
        });
    });
    $(`#knowledge-table tr td .table_operation_btn_waring`).click(function(){
        const knowledge_id=parseInt($(this).attr("data"))
        $.ajax({
            type: "delete",
            url: "/knowledge/delete",
            data: {"knowledge_id":knowledge_id},
            success: function (response) {
                if(response.message){
                    $(`#knowledge_id_${knowledge_id}`).remove()
                }
            }
        });
    })


    function get_knowledge_form(type){
        let group_id=parseInt($(`#${type}_bind_action_group`).val())
        if(!group_id){
            group_id=-1
        }
        const form = {
            "answer_type": parseInt($(`#${type}_answer_type`).val()),
            "action_group":group_id,
            "question": String($(`#${type}_question`).val()), // Changed from parseInt to direct value
            "answer": String($(`#${type}_answer`).val())      // Changed from parseInt to direct value
        };
        return form
    }

    $(`#add_knowledge_submit`).click(function(){
        const form= get_knowledge_form("add")
        $.ajax({
            type: "post",
            url: url + "/knowledge/add",
            contentType: "application/json",
            dataType: "json", 
            data: JSON.stringify(form),
            success: function (response) {
                if(response.message){
                    alert(response.message)
                    window.location.reload()
                }
            },
            error: function (xhr, status, error) {
                console.error("Error occurred: " + error);
            }
        });
    });

    $(`#modify_knowledge_submit`).click(function(){
        let form= get_knowledge_form("modify")
        form["knowledge_id"]=parseInt($(this).attr("data"))
        $.ajax({
            type: "put",
            url: url + "/knowledge/modify",
            data: form,
            success: function (response) {
                if(response.message){
                    for (let key in form) {
                        $(`#knowledge_id_${form["knowledge_id"]} td[name="${key}"]`).text(form[key])
                    }
                    const tr=$(`#knowledge_id_${form["knowledge_id"]}`)
                    console.log(tr)
                    tr.addClass('highlight');
                    setTimeout(function() {
                        tr.removeClass('highlight');
                    }, 3000);
                }
            },
            error: function (xhr, status, error) {
                console.error("Error occurred: " + error);
            }
        });
    });

    function update_action_group_knowledge(type){
        const bind_action_group=document.getElementById(`${type}_bind_action_group`)
        while (bind_action_group.children.length>1) {
            bind_action_group.removeChild(bind_action_group.children[1]);
        }
        return $.ajax({
            type: "get",
            url: "/knowledge/get_action_groups",
            success: function (response) {
                response.action_group.forEach(function(data,index){
                    $(`#${type}_bind_action_group`).append(
                        `<option value="${data.id}">${data.name}-${data.id}</option>  `
                    )
                })
            }
        });
    }

    $(`#knowledge-add`).click(function(){
        update_action_group_knowledge("add")
    })


    $(`#action_record`).click(function(){
        $(`#action_record_start`).css("display","none")
        $(`#action_record_end`).css("display","flex")
    })

    $(`#action_record_end`).click(function(){
        $(`#action_record_end`).css("display","none")
        $(`#action_record_start`).css("display","flex")
    })

    // ==================== 时间轴 UI 控件 ====================

    // 保存按钮 — 批量提交
    $('#timeline_save_btn').click(function () {
        if (!timelineGroupId) return;
        $(this).prop('disabled', true).text('保存中...');
        // 清理临时负 ID，构建提交数据
        const submitActions = timelineActions.map(function (a) {
            const item = {
                name: a.name,
                track: a.track || 1,
                command: typeof a.command === 'string' ? a.command : JSON.stringify(a.command),
                start_time: a.start_time || 0,
                duration: a.duration || 2.0
            };
            // 正 ID（已存在的）保留
            if (a.id > 0) item.id = a.id;
            return item;
        });
        var fd = new FormData();
        fd.append('group_id', timelineGroupId);
        fd.append('actions', JSON.stringify(submitActions));
        $.ajax({
            type: 'PUT',
            url: '/action/batch_save',
            data: fd,
            processData: false,
            contentType: false,
            success: function (response) {
                if (response.message === 'success') {
                    if (response.actions) {
                        timelineActions = response.actions.map(function (a) {
                            try {
                                var cmd = JSON.parse(a.command.replace(/'/g, '"').replace(/None/g, 'null'));
                                a.parts = Object.keys(cmd);
                            } catch (e) { a.parts = []; }
                            return a;
                        });
                    }
                    clearTimelineDirty();
                    rerenderTimelineLocal();
                    refresh_action_group();
                    $('#timeline_save_btn').text('💾 保存修改');
                } else {
                    alert('保存失败: ' + response.message);
                    $('#timeline_save_btn').prop('disabled', false).text('💾 保存修改');
                }
            },
            error: function () {
                alert('保存失败，请重试');
                $('#timeline_save_btn').prop('disabled', false).text('💾 保存修改');
            }
        });
    });

    // 缩放
    $('#timeline_zoom_in').click(function () {
        timelinePixelsPerSecond = Math.min(300, timelinePixelsPerSecond * 1.25);
        $('#timeline_zoom_label').text((timelinePixelsPerSecond / 80).toFixed(1) + 'x');
        if (timelineGroupId) renderTimeline(timelineGroupId);
    });
    $('#timeline_zoom_out').click(function () {
        timelinePixelsPerSecond = Math.max(20, timelinePixelsPerSecond / 1.25);
        $('#timeline_zoom_label').text((timelinePixelsPerSecond / 80).toFixed(1) + 'x');
        if (timelineGroupId) renderTimeline(timelineGroupId);
    });

    // 更新添加动作模态框以支持新字段
    const origAddActionClick = $('#add_action').prop('onclick');
    $('#add_action').off('click').click(function () {
        loading_on("add", "action_group");
        var groupId = parseInt($('#add_action_select_group').val());
        let form = {};
        form["action_name"] = $('#add_action_name').val();
        form["group_id"] = groupId;
        form["command"] = standar_get_control_form();
        form["start_time"] = 0;
        form["duration"] = 2.0;
        // 每个新动作放到新轨道
        form["track"] = _pendingTrack[groupId] || 1;
        console.log(form);
        // 直接提交到服务端
        $.ajax({
            type: "post",
            url: "/action/add",
            contentType: "application/json",
            data: JSON.stringify(form),
            success: function (response) {
                if (response.message === "success") {
                    if (response.duration) {
                        alert('添加成功！⏱ 预计 ' + response.duration + 's（仅供参考）');
                    } else {
                        alert('success');
                    }
                    // 如果当前时间轴是这个组，刷新
                    _pendingTrack[groupId] = (form["track"] || 1) + 1;  // 下次加到下一轨
                    if (timelineGroupId === form["group_id"]) {
                        renderTimeline(timelineGroupId);
                    }
                    refresh_action_group();
                } else {
                    alert(response.message);
                }
                setTimeout(function () { loading_off("add", "action_group"); }, 200);
            },
            error: function (xhr, status, error) {
                console.error(error);
                loading_off("add", "action_group");
            }
        });
    });

    // 修改动作（直接提交服务端）
    $('#modify_action').off('click').click(function () {
        loading_on("modify", "action");
        var actionId = parseInt($('#modify-action-modal').attr("data"));
        var groupId = parseInt($('#action-group-name').attr("data"));
        // 收集修改后的命令
        var commands = {};
        $('#modify_control_bar input[id^="modify_control-speed-"]').each(function () {
            var motorId = $(this).attr('id').split("-")[2];
            var part = $(this).attr('part') || 'arm';
            if (!commands[part]) commands[part] = [];
            commands[part].push({
                name_index: parseInt($(this).attr("name_index")),
                value: parseFloat($('#modify_control-position-' + motorId).val()),
                speed: parseFloat($(this).val()),
                part: part,
                current: default_current
            });
        });
        var fd = new FormData();
        fd.append('action_id', actionId);
        fd.append('action_name', $('#modify_action_name').val());
        fd.append('command', JSON.stringify(commands));
        fd.append('track', parseInt($('#modify-action-modal').attr("data-track")) || 1);
        fd.append('start_time', parseFloat($('#modify-action-modal').attr("data-start-time")) || 0);
        fd.append('duration', parseFloat($('#modify-action-modal').attr("data-duration")) || 2.0);
        $.ajax({
            type: "PUT",
            url: "/action/update",
            data: fd,
            processData: false,
            contentType: false,
            success: function (response) {
                if (response.message === "success") {
                    // 直接本地更新 duration + command，无需重新拉取
                    const act = timelineActions.find(a => a.id === actionId);
                    if (act) {
                        act.command = JSON.stringify(commands);
                        act.name = $('#modify_action_name').val();
                    }
                    if (response.duration) {
                        alert('修改成功！⏱ 新时长 ' + response.duration + 's（仅供参考）');
                    }
                    recalcDurations();
                    rerenderTimelineLocal();
                }
                loading_off("modify", "action");
            },
            error: function (xhr, status, error) {
                console.error(error);
                loading_off("modify", "action");
            }
        });
    });

    // ==================== 调用示例弹窗 ====================
    $('#show_call_example_btn').click(function () {
        const groupId = parseInt($('#action-group-name').attr('data'));
        if (!groupId) { alert('请先选择一个动作组'); return; }
        const groupName = $('#action-group-name').text();
        const code = `import requests

# === 调用 "${groupName}" 动作组 ===
url = "http://${window.location.hostname}:${window.location.port}/action_group/run"
data = {
    "group_id": ${groupId},
    "cycle": False,        # 是否循环
    "start_from": 0        # 从第几秒开始
}

response = requests.post(url, json=data)
print(response.json())`;
        $('#call_example_code').text(code);
        $('#call-example-modal').css('display', 'flex');
    });

    $('#close-call-example-modal').click(function () {
        $('#call-example-modal').css('display', 'none');
    });

    $('#copy_call_example_btn').click(function () {
        const code = $('#call_example_code').text();
        navigator.clipboard.writeText(code).then(function () {
            const btn = $('#copy_call_example_btn');
            btn.text('✅ 已复制!');
            setTimeout(() => btn.text('📋 复制代码'), 1500);
        });
    });

    // 点击弹窗外部关闭
    window.addEventListener('click', function (ev) {
        if (ev.target === document.getElementById('call-example-modal')) {
            $('#call-example-modal').css('display', 'none');
        }
    });
});
