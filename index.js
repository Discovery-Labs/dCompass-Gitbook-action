import dotenv from "dotenv";
dotenv.config();
import core from "@actions/core";
import github from "@actions/github";
import publishedModel from "./model.json";

// import { storeNFTData } from "./src/services/nft-storage/nft-storage-service.js";
import { Web3Storage, File, getFilesFromPath } from "web3.storage";
import { CeramicClient } from "@ceramicnetwork/http-client";
import { DID } from "dids";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";
import { fromString, toString } from "uint8arrays";
import { randomBytes } from "@stablelib/random";
// The key must be provided as an environment variable
import { DataModel } from "@glazed/datamodel";
import { DIDDataStore } from "@glazed/did-datastore";
import { Core } from "@self.id/core";

// import Box from '3box';
// import { legacy3BoxToCeramic } from './legacy3BoxToCeramic';

export const CERAMIC_TESTNET = "testnet-clay";
export const CERAMIC_TESTNET_NODE_URL = "https://ceramic-clay.3boxlabs.com";
export const CERAMIC_MAINNET_NODE_URL = "https://gateway.ceramic.network";
export const CERAMIC_LOCAL_NODE_URL = "http://localhost:7007";

function getAccessToken() {
  return process.env.WEB3STORAGE_TOKEN; // TODO: core.getInput("WEB3STORAGE_TOKEN");
}

function makeStorageClient() {
  return new Web3Storage({ token: getAccessToken() });
}

async function storeWithProgress(files) {
  // show the root cid as soon as it's ready
  const onRootCidReady = (cid) => {
    console.log("uploading files with cid:", cid);
  };

  // when each chunk is stored, update the percentage complete and display
  const totalSize = files.map((f) => f.size).reduce((a, b) => a + b, 0);
  let uploaded = 0;

  const onChunkStored = (size) => {
    uploaded += size;
    const pct = totalSize / uploaded;
    console.log(`Uploading... ${pct.toFixed(2)}% complete`);
  };

  // makeStorageClient returns an authorized Web3.Storage client instance
  const client = makeStorageClient();

  // client.put will invoke our callbacks during the upload
  // and return the root cid when the upload completes
  return client.put(files, { onRootCidReady, onChunkStored });
}

async function getFiles(path) {
  // const filesToIgnore = process.env.FILES_TO_IGNORE.split(",").map(
  //   (fileToIgnore) => fileToIgnore.trim()
  // );
  return getFilesFromPath(path);
  // return getFilesFromPath(path, {
  //   ignore: filesToIgnore,
  // });
}

async function uploadFilesToWeb3Storage() {
  // TODO: make sure that the github account of the contributor is linked with an ethereum address
  const client = makeStorageClient();
  const gitbookFiles = await getFiles(process.cwd() + "/test_files");
  // TODO: Check which files need to be uploaded through github.context.payload
  const rootCid = await storeWithProgress(gitbookFiles);
  const info = await client.status(rootCid);
  const res = await client.get(rootCid); // Web3Response
  const files = await res.files(); // Web3File[]
  return { rootCid, files };
}

async function getContext() {
  // This should be a token with access to your repository scoped in as a secret.
  // The YML workflow will need to set myToken with the GitHub Secret Token
  // myToken: ${{ secrets.GITHUB_TOKEN }}
  // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
  const payload = github.context.payload;
  const authors = github.context.payload.commits.map((commit) => commit.author);
  // const githubToken = core.getInput('GITHUB_TOKEN');

  // const octokit = github.getOctokit(githubToken)

  // You can also pass in additional options as a second parameter to getOctokit
  // const octokit = github.getOctokit(myToken, {userAgent: "MyActionVersion1"});

  // const { data: pullRequest } = await octokit.rest.pulls.get({
  //     owner: 'Discovery-Labs',
  //     repo: 'knowsis',
  //     pull_number: 123,
  //     mediaType: {
  //       format: 'diff'
  //     }
  // });
  // console.log(pullRequest);

  return { payload, ctx: github.context, authors };
}

async function getRepoOwner() {
  return github.context.payload.repository.owner.login;
}

const ceramicDataModelFactory = async () => {
  const DID_KEY = process.env.DID_KEY; // TODO: core.getInput("DID_KEY");
  const key = fromString(DID_KEY, "base16");
  // Create and authenticate the DID
  const did = new DID({
    provider: new Ed25519Provider(key),
    resolver: getResolver(),
  });
  await did.authenticate();

  // Connect to the testnet local Ceramic node
  const ceramic = new CeramicClient(CERAMIC_TESTNET_NODE_URL);
  ceramic.did = did;
  const model = new DataModel({ ceramic, model: publishedModel });
  const dataStore = new DIDDataStore({ ceramic, model });
  return { dataStore, model, ceramic };
};

async function main() {
  const { files, rootCid } = await uploadFilesToWeb3Storage();
  const { ctx, payload, authors } = await getContext();
  const projectId = process.env.DCOMPASS_PROJECT_ID;
  // const apiKey = process.env.DCOMPASS_API_KEY;

  const ceramicClient = await ceramicDataModelFactory();
  const ogProjectDoc = await ceramicClient.ceramic.loadStream(projectId);
  const owner = ogProjectDoc.controllers[0];
  const coreCeramicClient = new Core({
    ceramic: CERAMIC_TESTNET_NODE_URL,
    model: publishedModel,
  });

  const ownerWebAccounts = await coreCeramicClient.get("alsoKnownAs", owner);
  console.log({ ownerWebAccounts });
  if (
    !ownerWebAccounts ||
    !ownerWebAccounts.accounts ||
    ownerWebAccounts.accounts.length === 0
  ) {
    return null;
  }
  const ownerGithubAccount = ownerWebAccounts.accounts.find(
    (a) => a.host === "github.com"
  );
  if (!ownerGithubAccount) {
    return null;
  }
  const ownerGithubUsername = ownerGithubAccount.id;

  const repoOwner = getRepoOwner();
  console.log({ ownerGithubUsername, repoOwner });
  if (repoOwner !== ownerGithubAccount) {
    return null;
  }
  // const repoMembers = ["Cali93"];
  // if (!repoMembers.includes(ownerGithubUsername)) {
  //   return null;
  // }
  console.log({ ogProjectDoc });
  const allProjects = await ceramicClient.dataStore.get(
    "@dCompass/appprojects"
  );

  const projects = allProjects.projects ?? [];
  console.log({ projects });

  const project = allProjects.projects.find(
    (project) => project.id === projectId
  );
  if (!project) {
    return null;
  }

  const projectWithNewGitbookCid = {
    ...project,
    gitbookCid: rootCid,
  };

  const updatedProjects = await ceramicClient.dataStore.set(
    "@dCompass/appprojects",
    {
      projects: [
        ...projects.filter((project) => project.id !== projectId),
        projectWithNewGitbookCid,
      ],
    }
  );
}

main();
