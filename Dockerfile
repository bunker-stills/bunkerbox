FROM resin/raspberrypi-node:onbuild

RUN apt-get update && apt-get install -y libusb-1.0-0 libudev0 pm-utils owserver && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN wget http://download.tinkerforge.com/tools/brickd/linux/brickd_linux_latest_armhf.deb && dpkg -i brickd_linux_latest_armhf.deb && rm brickd_linux_latest_armhf.deb

RUN mkdir -p /usr/src/app/cascade && ln -s /usr/src/app /app

WORKDIR /usr/src/app/cascade
COPY cascade/package.json /usr/src/app/cascade/
RUN DEBIAN_FRONTEND=noninteractive JOBS=MAX npm install --unsafe-perm

WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN DEBIAN_FRONTEND=noninteractive JOBS=MAX npm install --unsafe-perm

COPY . /usr/src/app

CMD ["node", "server.js"]