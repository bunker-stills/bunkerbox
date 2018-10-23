var _ = require("underscore");

function pid()
{
    this.Kp = 0;
    this.Ki = 0;
    this.Kd = 0;
    this.reset();
}
module.exports = pid;
pid.prototype.reset = function()
{
    this.lastMeasurementTime = 0;
    this.setPoint = 0;
    this.previousError = 0;
    this.integral = 0;
    this.ki_previous = 0;
}

pid.prototype.setDesiredValue = function(setPoint)
{
    this.setPoint = setPoint;
}

pid.prototype.setProportionalGain = function(Kp)
{
    this.Kp = Kp;
}

pid.prototype.setIntegralGain = function(Ki)
{
    this.Ki = Ki;
}

pid.prototype.setDerivativeGain = function(Kd)
{
    this.Kd = Kd;
}

pid.prototype.update = function(measuredValue)
{
    var now = Date.now();
    var dt;

    if(!this.lastMeasurementTime)
    {
        dt = 1.0;
    }
    else
    {
        dt = (now - this.lastMeasurementTime) / 1000.0;
        console.log()
    }

    var input = measuredValue;
    var newIntegral = this.integral;

    var error = this.setPoint - input;

    // See: https://bunkerstills.slack.com/archives/D2UK88YJV/p1483845031000999 for reasons we have this this way
    //newIntegral = newIntegral + (this.Ki * error * dt);

    // Changed back to this as per: https://bunkerstills.slack.com/archives/D2UK88YJV/p1540177563000100
    newIntegral = newIntegral + (error * dt);
    //integral = integral + (error * dt);

    // SJH If the Ki term has changed, we must scale integral
    if (this.Ki != 0 && this.Ki != this.ki_previous)
    {
        var integral_correction = this.ki_previous / this.Ki;
        newIntegral = newIntegral * integral_correction; // Scale the integral
        this.ki_previous = this.Ki;
    }

    var derivative = (error - this.previousError) / dt;

    // SJH Now use the standard PID form...
    var CV = this.Kp * error + this.Ki * newIntegral + this.Kd * derivative;

    if(!_.isUndefined(this.CVUpperLimit) && CV >= this.CVUpperLimit)
    {
        if(newIntegral > this.integral)
        {
            // Stop integrating, reset the integral back to what it was before.
            newIntegral = this.integral;
        }

        CV = this.CVUpperLimit;
    }

    if(!_.isUndefined(this.CVLowerLimit) && CV <= this.CVLowerLimit)
    {
        if(newIntegral < this.integral)
        {
            // Stop integrating, reset the integral back to what it was before.
            newIntegral = this.integral;
        }

        CV = this.CVLowerLimit;
    }

    this.integral = newIntegral;
    this.previousError = error;
    this.lastMeasurementTime = now;

    return CV;
}

pid.prototype.setControlValueLimits = function(lowerLimit, upperLimit, offset)
{
    this.CVLowerLimit = lowerLimit;
    this.CVUpperLimit = upperLimit;
    this.CVOffset = offset;
}

pid.prototype.getIntegral = function()
{
    return this.integral;
}

pid.prototype.setIntegral = function(integral)
{
    this.integral = integral;
}