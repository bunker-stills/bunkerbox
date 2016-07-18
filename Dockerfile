FROM resin/raspberrypi2-node:4.4.4

# libzmq3-dbg libzmq3-dev libzmq3

RUN apt-get update && apt-get install -y libusb-1.0-0 libudev0 pm-utils owfs && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN wget http://download.tinkerforge.com/tools/brickd/linux/brickd_linux_latest_armhf.deb && dpkg -i brickd_linux_latest_armhf.deb && rm brickd_linux_latest_armhf.deb

# Allow services to start
RUN echo "exit 0" > /usr/sbin/policy-rc.d

COPY . /app

WORKDIR /app

# RUN npm install pm2 -g
RUN npm install && npm cache clean && rm -rf /tmp/*

#Start our BunkerBox App
CMD ["node", "server.js"]