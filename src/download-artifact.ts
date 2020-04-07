import * as core from '@actions/core'
import * as downloadHttpClient from '@actions/artifact/lib/internal-download-http-client'
import {DownloadResponse} from '@actions/artifact/lib/internal-download-response'
import {getWorkSpaceDirectory} from '@actions/artifact/lib/internal-config-variables'
import {Inputs} from './constants'
import {normalize, resolve} from 'path'
import {createDirectoriesForArtifact} from '@actions/artifact/lib/internal-utils'
import {getDownloadSpecification} from '@actions/artifact/lib/internal-download-specification'
import {
  ArtifactResponse,
  ListArtifactsResponse
} from '@actions/artifact/lib/internal-contracts'

async function downloadArtifactsWithRegExp(
  pattern: string,
  path?: string | undefined
): Promise<DownloadResponse[]> {
  const response: DownloadResponse[] = []
  let artifacts: ListArtifactsResponse = {
    count: 0,
    value: []
  }
  let retry = 3
  while (retry) {
    try {
      artifacts = await downloadHttpClient.listArtifacts()
      break
    } catch (e) {
      if (e instanceof Error) core.warning(e.message)
      core.warning("Can't get Artifacts List! Retry after 60 second...")
      await new Promise(resolve => setTimeout(resolve, 60000))
      retry--
      if (retry == 0) throw e
    }
  }
  if (artifacts.count === 0) {
    core.info('Unable to find any artifacts for the associated workflow')
    return response
  }
  const regexp = new RegExp(pattern)
  artifacts.value = artifacts.value.filter(x => regexp.test(x.name))
  artifacts.count = artifacts.value.length
  if (artifacts.count === 0) {
    core.info('Unable to match any artifacts for the associated workflow')
    return response
  }
  if (!path) {
    path = getWorkSpaceDirectory()
  }
  path = normalize(path)
  path = resolve(path)

  const downloadQueue: {
    rsp: ArtifactResponse
    retry: number
    nextTime: number
  }[] = []
  // Add to download queue
  let downloadedArtifacts = 0
  while (downloadedArtifacts < artifacts.count) {
    const currentArtifactToDownload = artifacts.value[downloadedArtifacts]
    downloadedArtifacts += 1

    downloadQueue.push({
      rsp: currentArtifactToDownload,
      retry: 3,
      nextTime: Date.now()
    })
  }

  const downloadFailureList: ArtifactResponse[] = []
  while (downloadQueue.length > 0) {
    const downloadItem = downloadQueue.shift()
    if (downloadItem == null)
      throw Error('Download Queue has some critical error')

    const timeDiff = Date.now() - downloadItem.nextTime
    if (timeDiff < 0)
      await new Promise(resolve => setTimeout(resolve, timeDiff))

    try {
      const currentArtifactToDownload = downloadItem.rsp

      // Get container entries for the specific artifact
      const items = await downloadHttpClient.getContainerItems(
        currentArtifactToDownload.name,
        currentArtifactToDownload.fileContainerResourceUrl
      )

      const downloadSpecification = getDownloadSpecification(
        currentArtifactToDownload.name,
        items.value,
        path,
        true
      )
      if (downloadSpecification.filesToDownload.length === 0) {
        core.info(
          `No downloadable files were found for any artifact ${currentArtifactToDownload.name}`
        )
      } else {
        await createDirectoriesForArtifact(
          downloadSpecification.directoryStructure
        )
        await downloadHttpClient.downloadSingleArtifact(
          downloadSpecification.filesToDownload
        )
      }

      response.push({
        artifactName: currentArtifactToDownload.name,
        downloadPath: downloadSpecification.rootDownloadLocation
      })
    } catch (e) {
      downloadItem.retry--
      if (downloadItem.retry == 0) downloadFailureList.push(downloadItem.rsp)
      else {
        downloadItem.nextTime = Date.now() + 60000
        core.warning(
          `Retry to download ${downloadItem.rsp.name} after 60 second`
        )
        downloadQueue.push(downloadItem)
      }
    }
  }
  downloadFailureList.forEach(val => {
    core.warning(`Unable to download ${val.name}`)
  })
  if (downloadFailureList.length) throw Error('Download failure')

  return response
}

async function run(): Promise<void> {
  try {
    let pattern = core.getInput(Inputs.Pattern, {required: false})
    const path = core.getInput(Inputs.Path, {required: false})

    if (!pattern) {
      // download all artifacts
      pattern = '^(.*?)$'
    }
    const downloadResponse = await downloadArtifactsWithRegExp(pattern, path)
    core.info(`There were ${downloadResponse.length} artifacts downloaded`)
    for (const artifact of downloadResponse) {
      core.info(
        `Artifact ${artifact.artifactName} was downloaded to ${artifact.downloadPath}`
      )
    }
    core.info('Artifact download has finished successfully')
  } catch (err) {
    core.setFailed(err.message)
  }
}

run()
