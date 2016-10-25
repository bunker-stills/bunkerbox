FROM resin/raspberrypi2-node:4.4.4

RUN apt-get update && apt-get install -y libusb-1.0-0 libudev0 pm-utils owserver && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN wget http://download.tinkerforge.com/tools/brickd/linux/brickd_linux_latest_armhf.deb && dpkg -i brickd_linux_latest_armhf.deb && rm brickd_linux_latest_armhf.deb

# TODO: Check out http://bitjudo.com/blog/2014/03/13/building-efficient-dockerfiles-node-dot-js/

COPY package.json /tmp/package.json
COPY cascade/package.json /tmp/cascade/package.json
RUN cd /tmp && npm install
RUN cd /tmp/cascade && npm install

RUN mkdir -p /app && cp -a /tmp/node_modules /app/ && cp -a /tmp/cascade/node_modules /app/cascade/

COPY . /app

WORKDIR /app

CMD ["node", "server.js"]