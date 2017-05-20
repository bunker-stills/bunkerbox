var dutyCycle = function(cycleLengthInMS, onDutyCallback, offDutyCallback)
{
    var _timer;
    var _dutyPercentage;
    var _stop;

    function processCycle()
    {
        if(_stop)
        {
            return;
        }

        var msOn = _dutyPercentage * cycleLengthInMS;
        var msOff = cycleLengthInMS - msOn;

        if(onDutyCallback)
        {
            onDutyCallback();
        }

        _timer = setTimeout(function(){

            if(_stop)
            {
                return;
            }

            if(offDutyCallback)
            {
                offDutyCallback();
            }

            _timer = setTimeout(processCycle, msOff);

        }, msOn);
    }

    this.set = function(dutyPercentage)
    {
        _dutyPercentage = Math.max(0.0, Math.min(1.0, dutyPercentage)); // Clamp to a value between 0 and 1
    };

    this.start = function(dutyPercentage)
    {
        _stop = false;

        // If the timer is already running at the same cycle, skip it.
        if(_timer && dutyPercentage === _dutyPercentage)
        {
            return;
        }

        this.set(dutyPercentage);

        if(!_timer)
        {
            processCycle();
        }
    };

    this.stop = function()
    {
        _stop = true;

        if(_timer) {
            clearTimeout(_timer);
            _timer = null;
        }
    };
};

module.exports = dutyCycle;