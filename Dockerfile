FROM node:14

# Copies your code file from your action repository to the filesystem path `/` of the container
COPY . /.

RUN npm install
# Code file to execute when the docker container starts up (`entrypoint.sh`)
# ENTRYPOINT ["index.js"]

CMD ["node", "index.js"]