# installed tools

website - generator is just a script we have wrapped in a dockerfile to make it easier to run.
content-gen - is a wrapper we built on top of "MoneyPrinterTurbo" we pull down and build a dockerfile for. It is a public repo, so we can just pull it down and build it with any updates.
opencut - is a repo we need to pull down and then build a docker image for. It is a public repo, so we can just pull it down and build it.
opencut-controller - is the mcp controller that we need to build and run in a docker image. It is a public repo, so we can just pull it down and build it same as the opencut item.
llm-openllm - builds the latest local version of OpenLLM and runs it in a docker image. It is a public repo, so we can just pull it down and build it same as the opencut item.
