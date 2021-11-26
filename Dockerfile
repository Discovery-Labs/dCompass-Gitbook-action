FROM node:14

COPY . .

RUN npm install
# Code file to execute when the docker container starts up (`entrypoint.sh`)
# ENTRYPOINT ["index.js"]

CMD ["node", "--experimental-json-modules", "index.js"]