FROM ubuntu:xenial

ENV workdir /app

RUN mkdir ${workdir}
WORKDIR ${workdir}

RUN apt-get update
RUN apt-get install curl git apt-transport-https --assume-yes

# Install Swift
RUN curl -o swift.tar.gz https://swift.org/builds/swift-4.0-release/ubuntu1604/swift-4.0-RELEASE/swift-4.0-RELEASE-ubuntu16.04.tar.gz
RUN tar -zxf swift.tar.gz
RUN rm swift.tar.gz
ENV PATH="${workdir}/swift-4.0-RELEASE-ubuntu16.04/usr/bin:${PATH}"

# Add nodejs package source
RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -

# Add .NET core package sources
RUN curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg  
RUN mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg
RUN sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-xenial-prod xenial main" > /etc/apt/sources.list.d/dotnetdev.list'

RUN apt-get update
RUN apt-get install nodejs maven default-jdk clang binutils golang-go --assume-yes
RUN apt-get install dotnet-sdk-2.0.0 --assume-yes

# Cache node_modules
ADD package.json package-lock.json ./
RUN npm install
ENV PATH="${workdir}/node_modules/.bin:${PATH}"

ADD bower.json ./
RUN bower install --allow-root

COPY . .

# Assemble output for publishing (does not publish)
ENV CI=true
RUN script/publish.sh

RUN npm install
RUN npm run build
#CMD sh -c "npm install && npm run build"