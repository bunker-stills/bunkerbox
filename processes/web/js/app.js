var touchTimer;
var mouseDown = false;

$(document).on("touchup mouseup", function(){
    clearInterval(touchTimer);
    mouseDown = false;
});

function repeatFunctionWhileMouseDown(element, func)
{
    mouseDown = true;
    func();

    // Wait for 2 seconds
    setTimeout(function(){

        if(!mouseDown) return;

        touchTimer = setInterval(function(){

            if(!mouseDown)
            {
                clearInterval(touchTimer);
                return;
            }

            func();

        }, 100);

    }, 1000);
}

var unitsClass = ko.observable("degrees-f");

var displayModel = {
    sections : ko.observableArray(),
    addSection : function(section)
    {
        this.sections.push(section);
    }
};

var setPointSection = function(name)
{
    var self = this;
    this.name = name;
    this.type = "setPoint";
    this.setPoint = 0.0;
    this.displaySetPoint = ko.observable("0.0");
    this.editing = ko.observable(false);

    this.displayClass = ko.computed(function(){
        return unitsClass() + (self.editing() ? ' editing' : '');
    });

    this.setSetPoint = function(value)
    {
        self.setPoint = value;
        self.displaySetPoint(value);
    };

    this.clickIncreaseSetPoint = function(data, event)
    {
        self.editing(true);
        repeatFunctionWhileMouseDown(event.target, function(){
            var newValue = Number(self.displaySetPoint()) + 0.25;
            self.displaySetPoint(newValue.toFixed(2));
        });
    };

    this.clickDecreaseSetPoint = function(data, event)
    {
        self.editing(true);
        repeatFunctionWhileMouseDown(event.target, function() {
            var newValue = Number(self.displaySetPoint()) - 0.25;
            self.displaySetPoint(newValue.toFixed(2));
        });
    };

    this.commitSetPoint = function()
    {
        self.setPoint = self.displaySetPoint();
        self.editing(false);
    };

    this.cancelSetPoint = function()
    {
        self.displaySetPoint(self.setPoint);
        self.editing(false);
    };
};

$(function(){

    displayModel.addSection(new setPointSection("Heads Temperature"));
    displayModel.addSection(new setPointSection("Hearts Temperature"));
    displayModel.addSection(new setPointSection("Tails Temperature"));
    ko.applyBindings(displayModel);

});