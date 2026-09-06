import {
  bootstrapLocalAzureDevOpsCli,
  bootstrapLocalBitbucketCli,
  bootstrapLocalGitHubCli,
  bootstrapLocalGitLabCli,
} from "./bootstrap-github-cli-dev.mjs";

await bootstrapLocalGitHubCli();
await bootstrapLocalGitLabCli();
await bootstrapLocalBitbucketCli();
await bootstrapLocalAzureDevOpsCli();
