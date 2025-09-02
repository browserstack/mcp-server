// Utility for fetching the count of Percy builds and orgId.
export async function getPercyBuildCount(percyToken: string) {
  const apiUrl = `https://percy.io/api/v1/builds`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Token token=${percyToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Percy builds: ${response.statusText}`);
  }

  const data = await response.json();
  const builds = data.data ?? [];
  const included = data.included ?? [];

  let isFirstBuild = false;
  let lastBuildId: string | undefined;
  let orgId: string | undefined;
  let browserIds: string[] = [];

  if (builds.length === 0) {
    return {
      noBuilds: true,
      isFirstBuild: false,
      lastBuildId: undefined,
      orgId,
      browserIds: [],
    };
  } else {
    isFirstBuild = builds.length === 1;
    lastBuildId = builds[0].id;
  }

  // Extract browserIds from the latest build if available
  browserIds =
    builds[0]?.relationships?.browsers?.data
      ?.map((b: any) => b.id)
      ?.filter((id: any) => typeof id === "string") ?? [];

  // Extract orgId from the `included` projects block
  const project = included.find((item: any) => item.type === "projects");
  if (project?.relationships?.organization?.data?.id) {
    orgId = project.relationships.organization.data.id;
  }

  return { noBuilds: false, isFirstBuild, lastBuildId, orgId, browserIds };
}
