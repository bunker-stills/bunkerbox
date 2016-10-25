FROM resin/raspberrypi-node:onbuild

RUN apt-get update && apt-get install -y libusb-1.0-0 libudev0 pm-utils owserver && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN wget http://download.tinkerforge.com/tools/brickd/linux/brickd_linux_latest_armhf.deb && dpkg -i brickd_linux_latest_armhf.deb && rm brickd_linux_latest_armhf.deb

# TODO: Check out http://bitjudo.com/blog/2014/03/13/building-efficient-dockerfiles-node-dot-js/

ADD package.json /app/package.json
RUN cd /app && npm install

ADD cascade/package.json /app/cascade/package.json
RUN cd /app/cascade && npm install

COPY . /app

WORKDIR /app

CMD ["node", "server.js"]