import * as core from '@actions/core'
import * as downloadHttpClient from '@actions/artifact/lib/internal-download-http-client'
import {DownloadResponse} from '@actions/artifact/lib/internal-download-response'
import {getWorkSpaceDirectory} from '@actions/artifact/lib/internal-config-variables'
import {Inputs} from './constants'
import {normalize, resolve} from 'path'
import {createDirectoriesForArtifact} from '@actions/artifact/lib/internal-utils'
import {getDownloadSpecification} from '@actions/artifact/lib/internal-download-specification'

async function downloadArtifactsWithRegExp(
  pattern: string,
  path?: string | undefined
): Promise<DownloadResponse[]> {
  const response: DownloadResponse[] = []
  const artifacts = await downloadHttpClient.listArtifacts()
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

  let downloadedArtifacts = 0
  while (downloadedArtifacts < artifacts.count) {
    const currentArtifactToDownload = artifacts.value[downloadedArtifacts]
    downloadedArtifacts += 1

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
  }
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
