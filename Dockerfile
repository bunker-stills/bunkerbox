FROM resin/raspberrypi2-node:4.4.4

RUN apt-get update && apt-get install -y libusb-1.0-0 libudev0 pm-utils owfs && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN wget http://download.tinkerforge.com/tools/brickd/linux/brickd_linux_latest_armhf.deb && dpkg -i brickd_linux_latest_armhf.deb && rm brickd_linux_latest_armhf.deb

# TODO: Check out http://bitjudo.com/blog/2014/03/13/building-efficient-dockerfiles-node-dot-js/

# Allow services to start
RUN echo "exit 0" > /usr/sbin/policy-rc.d

COPY . /app

RUN mkdir -p /tmp/cascade
ADD cascade/package.json /tmp/cascade/package.json

ADD package.json /tmp/package.json
RUN cd /tmp && npm install
RUN cp -a /tmp/node_modules /app && cp -a /tmp/cascade/node_modules /app/cascade/node_modules

WORKDIR /app

# RUN npm install pm2 -g
#RUN npm install && npm cache clean && rm -rf /tmp/*

#Start our BunkerBox App
CMD ["node", "server.js"]