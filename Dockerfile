# To push this repo, log in as "schani" on DockerHub, and
#   docker tag IMAGE-ID schani/quicktype
#   docker push schani/quicktype

FROM ubuntu:xenial-20180525

ENV workdir /app

RUN mkdir ${workdir}
WORKDIR ${workdir}

RUN apt-get -y update --fix-missing
RUN apt-get -y install curl git apt-transport-https --assume-yes

# Install Swift
RUN curl -o swift.tar.gz https://swift.org/builds/swift-4.1.3-release/ubuntu1604/swift-4.1.3-RELEASE/swift-4.1.3-RELEASE-ubuntu16.04.tar.gz
RUN tar -zxf swift.tar.gz
RUN rm swift.tar.gz
ENV PATH="${workdir}/swift-4.1.3-RELEASE-ubuntu16.04/usr/bin:${PATH}"

# Add nodejs package source
RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -

# Add .NET core package sources
RUN curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
RUN mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg
RUN sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-xenial-prod xenial main" > /etc/apt/sources.list.d/dotnetdev.list'

RUN apt-get -y update
RUN apt-get -y install nodejs maven default-jdk clang binutils golang-go --assume-yes
RUN apt-get -y install dotnet-sdk-2.0.0 --assume-yes

# Install Boost for C++
RUN apt-get -y install libboost-all-dev --assume-yes
RUN apt-get -y update && apt-get -y install software-properties-common python-software-properties --assume-yes
RUN add-apt-repository ppa:jonathonf/gcc
RUN apt-get -y update
RUN apt-get -y install g++-7 --assume-yes
RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-7 60 --slave /usr/bin/g++ g++ /usr/bin/g++-7
RUN update-alternatives --config gcc

# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Pike
RUN apt-get -y update
RUN apt-get -y install pike8.0-full --assume-yes

# Tool to limit elm-make cores
RUN git clone https://github.com/obmarg/libsysconfcpus.git
RUN cd libsysconfcpus && ./configure && make && make install

# Ruby
RUN apt-get -y install ruby --assume-yes
RUN gem install bundler

# Kotlin
RUN echo | openssl s_client -showcerts -servername get.sdkman.io -connect get.sdkman.io:443 2>/dev/null | awk '/-----BEGIN CERTIFICATE-----/, /-----END CERTIFICATE-----/' >> /usr/local/share/ca-certificates/ca-certificates.crt  && update-ca-certificates
RUN curl -s https://get.sdkman.io | bash
RUN /bin/bash -c "source /root/.sdkman/bin/sdkman-init.sh && sdk install kotlin"
ENV PATH="/root/.sdkman/candidates/kotlin/current/bin:${PATH}"

# Python
RUN add-apt-repository ppa:deadsnakes/ppa
RUN apt-get -y update
RUN apt-get -y install python3.6 --assume-yes
RUN curl https://bootstrap.pypa.io/get-pip.py | python3.6
RUN pip3.6 install mypy python-dateutil

# PHP
RUN export LANG=C.UTF-8 ; add-apt-repository ppa:ondrej/php
RUN apt-get -y update
RUN apt-get -y install php7.4 --assume-yes

# Dart
RUN apt-get -y install apt-transport-https
RUN sh -c 'curl https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -'
RUN sh -c 'curl https://storage.googleapis.com/download.dartlang.org/linux/debian/dart_stable.list > /etc/apt/sources.list.d/dart_stable.list'
RUN apt-get -y update
RUN apt-get -y --allow-unauthenticated install dart

# Crystal
RUN curl -sL "https://keybase.io/crystal/pgp_keys.asc" | apt-key add -
RUN echo "deb https://dist.crystal-lang.org/apt crystal main" | tee /etc/apt/sources.list.d/crystal.list
RUN apt-get -y update
RUN apt-get -y install crystal --assume-yes

# Haskell
RUN curl -sL "https://get.haskellstack.org/" | sh

ENV PATH="${workdir}/node_modules/.bin:${PATH}"

COPY . .

ENV CI=true
RUN npm install --unsafe-perm
RUN npm run tslint
