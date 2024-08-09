// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

type Thumbnails = {
  url: string
  width: number
  height: number
}

// YouTube Search:list Response
// https://developers.google.com/youtube/v3/docs/search/list
type ResponseYouTubeSearchList = {
  kind: 'youtube#searchListResponse'
  etag: string
  regionCode: string
  pageInfo: { totalResults: number; resultsPerPage: number }
  items: Array<{
    kind: 'youtube#searchResult'
    etag: string
    id: { kind: 'youtube#video'; videoId: string }
    snippet: {
      publishedAt: string
      channelId: string
      title: string
      description: string
      thumbnails: { default: Thumbnails; medium: Thumbnails; high: Thumbnails }
      channelTitle: string
      liveBroadcastContent: string
      publishTime: string
    }
  }>
}

type QueryParams = {
  part: string
  type: 'channel' | 'playlist' | 'video'
  q: string // search keyword
  publishedBefore: string
  publishedAfter: string
  maxResults: string
  pageToken: string
  key: string
}

const getPublishedBefore = (): string => {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0, // minute
    0, // second
    0 // ms
  ).toISOString()
}

const getPublishedAfter = (): string => {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() - 1,
    0, // minute
    0, // second
    0 // ms
  ).toISOString()
}

Deno.serve(async () => {
  const queryParams: QueryParams = {
    part: 'snippet',
    type: 'video',
    q: 'search keyword',
    publishedBefore: getPublishedBefore(),
    publishedAfter: getPublishedAfter(),
    maxResults: '1',
    pageToken: '',
    key: Deno.env.get('GOOGLE_API_KEY') ?? '',
  }

  let data: ResponseYouTubeSearchList | Record<string | number | symbol, never> = {}

  try {
    const paramStr: URLSearchParams = new URLSearchParams(queryParams)

    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${paramStr.toString()}`)
    data = await res.json()
  } catch (e) {
    console.error(e)
  }
  console.log(data)
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/search-youtube-cron-job' \
    --header 'Authorization: Bearer' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
