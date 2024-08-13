// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
const supabase = createClient(
  Deno.env.get('EF_SUPABASE_URL') ?? '',
  Deno.env.get('EF_SUPABASE_ANON_KEY') ?? ''
)

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
  nextPageToken: string
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

// supabase table
// search_keyword
type SupabaseSearchKeywordRecord = {
  id: number
  keyword: string
  starts_at: string
  ends_at: string
  created_at: string
}

type QueryParams = {
  part: string
  type: 'channel' | 'playlist' | 'video'
  q: string // search keyword
  publishedBefore: string // 指定した時刻以前に作成されたリソース
  publishedAfter: string // 指定した時刻以降に作成されたリソース
  maxResults: string
  order: 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount'
  pageToken: string
  key: string
}

/**
 * YouTube search window: start
 * @returns
 */
const getPublishedBefore = (): Date => {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0, // minute
    0, // second
    0 // ms
  )
}

/**
 * YouTube search window: end
 * @returns
 */
const getPublishedAfter = (): Date => {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() - 1,
    0, // minute
    0, // second
    0 // ms
  )
}

/**
 * get for valid searches from supabase table
 * @returns
 */
const fetchSupabaseSearchKeywords = async (): Promise<Array<SupabaseSearchKeywordRecord> | []> => {
  const { data, error } = await supabase
    .from('search_keyword')
    .select('*')
    .lte('starts_at', getPublishedAfter().toISOString())
    .lte('starts_at', getPublishedBefore().toISOString())
    .gte('ends_at', getPublishedAfter().toISOString())
    .gte('ends_at', getPublishedBefore().toISOString())

  if (!data) return []

  return data
}

/**
 * search YouTube
 * @param keyword
 * @param nextPageToken
 * @returns
 */
const fetchSearchYouTube = async (
  supabaseSearchKeywordRecord: SupabaseSearchKeywordRecord,
  nextPageToken: string = ''
): Promise<{ id: number; items: ResponseYouTubeSearchList['items'] }> => {
  const paramStr: URLSearchParams = new URLSearchParams({
    ...queryParams,
    q: supabaseSearchKeywordRecord.keyword,
    pageToken: nextPageToken,
  })

  try {
    const fetchUrl: string = `https://www.googleapis.com/youtube/v3/search?${paramStr.toString()}`
    const res = await fetch(fetchUrl)
    const data: ResponseYouTubeSearchList = await res.json()

    let results: ResponseYouTubeSearchList['items'] = data.items

    if (data.nextPageToken) {
      const nextResults = await fetchSearchYouTube(supabaseSearchKeywordRecord, data.nextPageToken)
      if (nextResults.items) results = results.concat(nextResults.items)
    }

    return {
      id: supabaseSearchKeywordRecord.id,
      items: results,
    }
  } catch (error) {
    console.error(error)
  }

  return {
    id: supabaseSearchKeywordRecord.id,
    items: [],
  }
}

/**
 * YouTube Data API query parameter
 */
const queryParams: QueryParams = {
  part: 'snippet',
  type: 'video',
  q: '', // search keyword
  publishedBefore: getPublishedBefore().toISOString(),
  publishedAfter: getPublishedAfter().toISOString(),
  maxResults: '50',
  order: 'date',
  pageToken: '',
  key: Deno.env.get('GOOGLE_API_KEY') ?? '',
}

Deno.serve(async (req) => {
  try {
    // 1. get search keyword and period for YouTube Data API from supabase
    const resSearchKeywords: Array<SupabaseSearchKeywordRecord> =
      await fetchSupabaseSearchKeywords()
    if (!resSearchKeywords.length) {
      console.log('No search keywords.')
      return new Response()
    }

    // 2. supabase authentication
    const { data: authUser, error: authError } = await supabase.auth.signInWithPassword({
      email: Deno.env.get('EF_SUPABASE_EMAIL') ?? '',
      password: Deno.env.get('EF_SUPABASE_PASSWORD') ?? '',
    })
    if (authError) throw 'Supabase authentication failed.'

    // 3. search YouTube
    const fetchPromises = resSearchKeywords.map((res) => fetchSearchYouTube(res))
    const resYouTubeSearchResults = await Promise.all(fetchPromises)

    const insertRecords = resYouTubeSearchResults.flatMap((res) =>
      res.items.map((item) => ({
        item,
        search_keyword_id: res.id,
      }))
    )

    // 4. insert@
    const { data: insertResponse, error } = await supabase
      .from('search_result')
      .insert(insertRecords)
      .select()

    if (error) throw error
  } catch (e) {
    console.error(e)
  }

  return new Response()
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/search-youtube-cron-job' \
    --header 'Authorization: Bearer' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
