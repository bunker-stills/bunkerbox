var API_ROOT = location.origin + "/api";

var current_process;
var allow_update_components = false;

function initialize()
{
    get_process_list();
    load_process(get_location_hash());

    window.addEventListener("hashchange", function(){
        load_process(get_location_hash());
    }, false);

    component_loop();
}

function get_location_hash()
{
    return location.hash.replace(/^#/, "");
}

function end_edit_component()
{
    $(".component_input").css("padding-left", "").unbind("keyup").unbind("blur");
    $("#component_editor").remove();
}

function commit_edit_component(component_element) {

    var component_data = component_element.data("details");

    var new_value;

    switch(component_element.attr("type"))
    {
        case "checkbox" :
        {
            new_value = component_element.prop("checked");
            break;
        }
        default:
        {
            new_value = component_element.val();
        }
    }

    $.ajax({
        method: "post",
        dataType: "json",
        contentType : "application/json",
        url: API_ROOT + "/processes/" + current_process + "/" + component_data.id,
        data : JSON.stringify({
            value : new_value
        })
    }).done(function( data ) {
        if(data)
        {
            component_data.value = data;
            component_element.data("details", component_data);
        }

        component_element.unbind("blur");
        component_element.blur();
        end_edit_component();
    });
}

function cancel_edit_component(component_element)
{
    var component_data = component_element.data("details");

    component_element.val(component_data.value);

    end_edit_component();
}

function begin_edit_component(e)
{
    var component_element = $(e.target);

    $("#component_editor").remove();

    var edit_div = $('<div id="component_editor"></div>');

    var accept_button = $('<button class="button-primary"><i class="fa fa-check"></i></button>');
    accept_button.on('mousedown', function(e){
        commit_edit_component(component_element);
        e.preventDefault();
    });

    var cancel_button = $('<button class="button-primary cancel_button"><i class="fa fa-times"></i></button>');
    cancel_button.on('mousedown', function(){
        cancel_edit_component(component_element);
        e.preventDefault();
    });

    edit_div.append(accept_button);
    edit_div.append(cancel_button);

    component_element.before(edit_div);

    component_element.css("padding-left", edit_div.width() + 10);
    component_element.select();

    component_element.on("keyup", function(e){
        if (e.keyCode == 27) // escape key
        {
            cancel_edit_component(component_element);
        }
        else if(e.keyCode == 13) // enter key
        {
            commit_edit_component(component_element);
        }
    });

    component_element.on("blur", function(){
        cancel_edit_component(component_element);
    });
}

function get_raw_component_info_text(component)
{
    var output = JSON.stringify(component, null, 4);

    output += "\r\n\r\nGET " + API_ROOT + "/processes/" + current_process + "/" + component.id;
    output += "\r\nPOST " + API_ROOT + "/processes/" + current_process + "/" + component.id + "?value={some_value}";

    return output;
}

function toggle_component_info(component)
{
    var component_detail_div = $("#component_info_" + component.id);

    if(component_detail_div.length)
    {
        return component_detail_div.remove();
    }

    component_detail_div = $('<div class="component_info"></div>');
    component_detail_div.attr("id", "component_info_" + component.id);

    var details = $('<pre><code>' + get_raw_component_info_text(component) + '</code></pre>');
    component_detail_div.append(details);

    $("#component_label_" + component.id).after(component_detail_div);
}

function load_components_for_process(process_name)
{
    loading_indicator(true);

    $.ajax({
        dataType: "json",
        url: API_ROOT + "/processes/" + process_name
    }).done(function( data ) {

        if(_.isEmpty(data.components))
        {
            allow_update_components = false;
            $("#components").append("None");
            return;
        }

        allow_update_components = true;

        _.each(data.components, function(component, component_name){

            var component_field = $("#component_field_" + component_name);

            if(component_field.length == 0)
            {
                var row = $('<div class="row"></div>');

                var value_column = $('<div class="twelve columns component"></div>');

                var name_label = $('<label class="component_label"></label>');
                name_label.attr("id", "component_label_" + component.id);
                name_label.text(component.name || component.id);

                name_label.on("click", function () {
                    toggle_component_info(component);
                });

                value_column.append(name_label);

                switch(component.type) {
                    case "OPTIONS" :
                    {
                        component_field = $('<select class="u-full-width"></select>');
                        component_field.attr("id", "component_field_" + component_name);

                        component_field.on("change", function(){
                            commit_edit_component(component_field);
                            component_field.blur();
                        });

                        value_column.append(component_field);

                        break;
                    }
                    case "BOOLEAN" :
                    {
                        component_field = $('<input type="checkbox">');
                        component_field.attr("id", "component_field_" + component_name);

                        component_field.on("click", function(){
                            commit_edit_component(component_field);
                        });

                        $('<label class="switch"></label>').append(component_field).append($('<div class="slider round"></div>')).appendTo(value_column);
                        break;
                    }
                    default:
                    {
                        component_field = $('<input class="u-full-width component_input" type="text">');
                        component_field.attr("id", "component_field_" + component_name);
                        component_field.focusin(begin_edit_component);
                        value_column.append(component_field);

                        var units = $('<span class="component_units"></span>');
                        units.text(component.units);
                        value_column.append(units);

                        component_field.css("padding-right", units.width() + 15);
                    }
                }

                row.append(value_column);
                $("#components").append(row);
            }

            component_field.prop("disabled", component.read_only);

            // Don't update the value if it's focused
            if(!component_field.is(":focus")) {

                var current_details = component_field.data("details");

                // If the value has changed, give a visual cue
                if(current_details && current_details.value != component.value)
                {
                    component_field.apply_animation("pulse");
                }

                switch(component.type)
                {
                    case "OPTIONS" :
                    {
                        component_field.empty();

                        component_field.append('<option value="">Select one...</option>');

                        _.each(component.info.options, function(option){

                            var option_field = $('<option></option>');
                            option_field.text(option);

                            if(component.value == option)
                            {
                                option_field.prop("selected", true);
                            }

                            component_field.append(option_field);

                        });

                        break;
                    }
                    case "BOOLEAN" :
                    {
                        component_field.prop("checked", component.value);
                        break;
                    }
                    default :
                    {
                        component_field.val(component.value);
                    }
                }

                // Update our component info box if it's open
                var component_info = $("#component_info_" + component.id);
                if(component_info.length)
                {
                    var component_info_code = component_info.find("pre code");
                    var current_text = component_info_code.text();
                    var new_text = get_raw_component_info_text(component);

                    if(current_text != new_text)
                    {
                        component_info_code.text(new_text).apply_animation("pulse");
                    }
                }
            }

            component_field.data("details", component);
        });

    }).always(function() {
        loading_indicator(false);
    });
}

function loading_indicator(show)
{
    $(".loading").toggleClass("fade-out", !show).toggleClass("fade-in", show);
}

// Reload our components
var component_loop_throttle = _.throttle(component_loop, 5000);
function component_loop()
{
    if(allow_update_components) {
        load_components_for_process(current_process);
    }

    component_loop_throttle();
}

function load_process(process_name)
{
    $("#processes").find(".active").removeClass("active");
    $("#processes").find("#process_" + process_name).addClass("active");

    $("#components").empty();

    allow_update_components = false;
    load_components_for_process(process_name);
    current_process = process_name;
}

function get_process_list()
{
    var process_element = $("#processes");

    process_element.empty();

    var current_process = get_location_hash();

    $.ajax({
        dataType: "json",
        url: API_ROOT + "/processes"
        //data: data
    }).done(function( data ) {

        _.each(data.processes, function(process, process_name){
            var row = $('<div class="row"></div>');

            var column = $('<div class="12 columns"></div>');

            var link = $('<a class="process"></a>');
            link.attr("id", "process_" + process_name);
            link.attr("href", "#" + process_name);
            link.text(process.name);

            if(process_name === current_process)
            {
                link.addClass("active");
            }

            column.append(link);
            row.append(column);
            process_element.append(row);
        });
    }).always(function() {
        loading_indicator(false);
    });
}

$.fn.extend({
    apply_animation: function (class_name) {
        var animationEnd = 'webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend';
        $(this).addClass(class_name).one(animationEnd, function() {
            $(this).removeClass(class_name);
        });
    }
});

$(initialize);