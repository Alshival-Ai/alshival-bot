Getting Started
Welcome to KLIPY API! KLIPY gives you lifetime access to a high-performance API for Clips, GIFs, Stickers, Memes and AI Emojis, designed to make your app more fun, expressive, and sticky.

Here's the full guide:

1
Generate your Key
Visit the Partner Panel, navigate to API Keys and create your platform.

Note: While your key is in Testing mode, it is limited to 100 API requests per hour.

2
Add Attribution
Incorporate KLIPY branding into your interface.

3
Go Live
Once you have finished testing, request Production access via the Partner Panel to unlock unlimited API requests.

For a more detailed look at our endpoints, review the technical specifications for each API below.

For platforms looking to generate revenue, our Ads API offers seamless monetization with high-fill programmatic & direct demand.

Leverage our Demo App Source Code to explore how KLIPY integrates with modern apps - with or without ads. It’s built to help you launch fast and scale smoothly with a clean UX and minimal latency.

Need help? Reach us anytime at developers@klipy.com

Was this section helpful?
Yes
No
Base URL

Primary:

https://api.klipy.com

Language Box

cURL
Ruby
Ruby
Python
Python
PHP
PHP
Java
Java
Node.js
Node.js
Go
Go
.NET
.NET
Network Requirements
If any software on your network filters or restricts outbound traffic, allowlist the following domains to ensure KLIPY works as expected:

Domain

Purpose

klipy.com

Core platform

api.klipy.com

API endpoint

static.klipy.com

Media delivery (GIFs, stickers, thumbnails)

static1.klipy.com

Media delivery (GIFs, stickers, thumbnails)

static2.klipy.com

Media delivery (GIFs, stickers, thumbnails)

All domains are served over HTTPS (port 443).

Need help? Reach us anytime at developers@klipy.com

Was this section helpful?
Yes
No
GIF API
The KLIPY GIF API gives you instant access to a curated, fast-loading library of trending and high-quality GIFs.

With a single integration, you can search, preview, and serve the most popular and localized GIFs in real time, delivering a smooth and engaging user experience across messaging, social apps, keyboards, and more.

All content is fully licensed and categorized, with support for tracking, personalization, and optional monetization via native ads.

Use this section to:

Fetch trending or recent GIFs
Search by keyword or tag
Browse by category
Track user interactions (views, shares, reports)
Was this section helpful?
Yes
No
Endpoints
GET
api/v1/{app_key}/gifs/trending?page={page}&per_page={per_page}&customer_id={customer_id}&l...

GET
api/v1/{app_key}/gifs/search?page={page}&per_page={per_page}&q={q}&customer_id={customer_i...

GET
api/v1/{app_key}/gifs/categories?locale={country_code}

GET
api/v1/{app_key}/gifs/recent/{customer_id}?page={page}&per_page={per_page}

GET
api/v1/{app_key}/gifs/items?slugs={value}

DELETE
api/v1/{app_key}/gifs/recent/{customer_id}?slug={slug}

POST
api/v1/{app_key}/gifs/share/{slug}

POST
api/v1/{app_key}/gifs/report/{slug}

GIF - Trending API
Use this endpoint to fetch the most popular and viral GIFs of the moment, automatically tailored to your user’s language and location.

Trending content is updated throughout the day and optimized for engagement across social, messaging, and keyboard experiences.

To monetize this feature, check out the Advertisements section

See our Demo App Source Code for an example of Trending API integration.

Query Parameters
page
integer
The requested page number

Minimum
1
Default value
1
per_page
integer
The number of content items per page

Minimum
1
Maximum
50
Default value
24
customer_id
string
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

locale
string
Country code / language of the customer ISO 3166 (ge; us; uk; ru etc) (Alpha-2) (https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#Officially_assigned_code_elements)

format_filter
string
Comma-separated list of desired formats. Results will include only these formats, even if other formats exist. Possible values: gif, webp, jpg, mp4, webm.

content_filter
string
Specify the content safety filter level. The accepted values are off, low, medium, and high.

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

ResponseExpand all
200
Object
Response Attributes
result
boolean
data
object
Show child attributes

Was this section helpful?
Yes
No
GET

/api/v1/{app_key}/gifs/trending?page={page}&per_page={per_page}&customer_id={customer_id}&locale={locale}&format_filter=&content_filter={content_filter}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/trending?page={page}&per_page={per_page}&customer_id={customer_id}&locale={locale}&content_filter={content_filter}' \
Response

200
{
  "result": true,
  "data": {
    "data": [
      {
        "id": 8041071659142944,
        "slug": "hello-hi-662",
        "title": "Hello",
        "file": {
          "hd": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif",
              "width": 498,
              "height": 498,
              "size": 4001918
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/eUbp2uNc.webp",
              "width": 498,
              "height": 498,
              "size": 285228
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg",
              "width": 498,
              "height": 498,
              "size": 19255
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KkjHgST0WkvqPhrQBEj.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "md": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/8GCrVAB7.gif",
              "width": 498,
              "height": 498,
              "size": 3721260
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp",
              "width": 498,
              "height": 498,
              "size": 643490
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/UsX8Vqtm.jpg",
              "width": 498,
              "height": 498,
              "size": 20086
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/V6da8Awi.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KYvHAODcgRYMmD.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "sm": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/y6iepZM7.gif",
              "width": 220,
              "height": 220,
              "size": 314884
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp",
              "width": 220,
              "height": 220,
              "size": 80118
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/uvntdY4w.jpg",
              "width": 220,
              "height": 220,
              "size": 8560
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/3c2Tqd1S.mp4",
              "width": 320,
              "height": 320,
              "size": 49565
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/E4zwjSqD1BNoXKAEm1UE.webm",
              "width": 320,
              "height": 320,
              "size": 48827
            }
          },
          "xs": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/A4bPjSsj.gif",
              "width": 90,
              "height": 90,
              "size": 71468
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/Sp4pln3Z.webp",
              "width": 90,
              "height": 90,
              "size": 25340
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/cGfi4U83.jpg",
              "width": 90,
              "height": 90,
              "size": 2949
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/La0HaAzw.mp4",
              "width": 150,
              "height": 150,
              "size": 20257
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/45Vik66JyFsr7B6NrYM.webm",
              "width": 150,
              "height": 150,
              "size": 38333
            }
          }
        },
        "tags": [],
        "type": "gif",
        "blur_preview": "data:image/jpeg;base64,/9j//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAADAQEBAAAAAAAAAAAAAAAFBgMEBwEBAAIDAQAAAAAAAAAAAAAAAAQDAAIBBRAAAgEEAQMDAQkBAAAAAAAAAgEDAAUEEQYxEyESYUGScZHhUkIHMqEjFBEAAgMAAgICAwEAAAAAAAAAAgEDABEEITESE2EiQVEy/8AAEQgAHgAeAwESAAISAAMSAP/aAAwDAQACEQMRAD8A7AMw48RynvQCyevaow52KaYsk001r7am2Y7LNVTj/e+OPkP/ABgJKEZe29i99dUA5dZoLbzGOSSMRgnmRepLXhuqOVosqpRYyd/uuGDQ3ukcYxkhxLtK9gPNjycbEyx/hKhf1UOmuWAuORLFP19qIGteyohO4GNLugvU8tpRJG9T83PyKe4WfLUsCZxTrwl8PrXsPL7VmYcPeDuMfHnzpqrbZ62vdy54MnEhW2QffSLk3WeEUbZNLqt9a3HWF4uey/tRG9JUxfMaHkF1TmMXHDti90rDyT0qY1GaLX5vxoWSEzP6rr0oOTHFFi/1RNtbny3PsmW8KKQiBtiktvarBj3fFyc1zTYvcME2mWnQr+UC6pPqm70hKCUFud3n/IQj03bhyaaKP/KTyRNkL/TSpd7qeTdJ3ACgSfT4/qlx8jV+Xm2KAG6RyOGxLQ7Tqg5cgiu9v//Z"
      }
    ],
    "current_page": 1,
    "per_page": 24,
    "has_next": true
  }
}

Show more
GIF - Search API
Use this endpoint to search KLIPY’s full GIF library by keyword or phrase. Results are ranked by relevance, popularity, and language context to ensure highly engaging, localized results.

The search engine supports fuzzy matching, custom pagination, and optional content filters to help you deliver the right result in every user flow.

Looking to monetize your search results? See the Advertisements section

Query Parameters
page
integer
The requested page number

Minimum
1
Default value
1
per_page
integer
The number of content items per page

Minimum
8
Maximum
50
Default value
24
q
string
The search keyword for finding relevant items

customer_id
string
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

locale
string
Country code / language of the customer ISO 3166 (ge; us; uk; ru etc) (Alpha-2) (https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#Officially_assigned_code_elements)

content_filter
string
Specify the content safety filter level. The accepted values are off, low, medium, and high.

format_filter
string
Comma-separated list of desired formats. Results will include only these formats, even if other formats exist. Possible values: gif, webp, jpg, mp4, webm.

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

ResponseExpand all
200
Object
Response Attributes
result
boolean
data
object
Show child attributes

Was this section helpful?
Yes
No
GET

/api/v1/{app_key}/gifs/search?page={page}&per_page={per_page}&q={q}&customer_id={customer_id}&locale={country_code}&content_filter={content_filter}&format_filter=

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/search?page={page}&per_page={per_page}&q={q}&customer_id={customer_id}&locale={country_code}&content_filter={content_filter}' \
Response

200
{
  "result": true,
  "data": {
    "data": [
      {
        "id": 8041071659142944,
        "slug": "hello-hi-662",
        "title": "Hello",
        "file": {
          "hd": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif",
              "width": 498,
              "height": 498,
              "size": 4001918
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/eUbp2uNc.webp",
              "width": 498,
              "height": 498,
              "size": 285228
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg",
              "width": 498,
              "height": 498,
              "size": 19255
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KkjHgST0WkvqPhrQBEj.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "md": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/8GCrVAB7.gif",
              "width": 498,
              "height": 498,
              "size": 3721260
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp",
              "width": 498,
              "height": 498,
              "size": 643490
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/UsX8Vqtm.jpg",
              "width": 498,
              "height": 498,
              "size": 20086
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/V6da8Awi.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KYvHAODcgRYMmD.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "sm": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/y6iepZM7.gif",
              "width": 220,
              "height": 220,
              "size": 314884
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp",
              "width": 220,
              "height": 220,
              "size": 80118
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/uvntdY4w.jpg",
              "width": 220,
              "height": 220,
              "size": 8560
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/3c2Tqd1S.mp4",
              "width": 320,
              "height": 320,
              "size": 49565
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/E4zwjSqD1BNoXKAEm1UE.webm",
              "width": 320,
              "height": 320,
              "size": 48827
            }
          },
          "xs": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/A4bPjSsj.gif",
              "width": 90,
              "height": 90,
              "size": 71468
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/Sp4pln3Z.webp",
              "width": 90,
              "height": 90,
              "size": 25340
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/cGfi4U83.jpg",
              "width": 90,
              "height": 90,
              "size": 2949
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/La0HaAzw.mp4",
              "width": 150,
              "height": 150,
              "size": 20257
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/45Vik66JyFsr7B6NrYM.webm",
              "width": 150,
              "height": 150,
              "size": 38333
            }
          }
        },
        "tags": [],
        "type": "gif",
        "blur_preview": "data:image/jpeg;base64,/9j//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAADAQEBAAAAAAAAAAAAAAAFBgMEBwEBAAIDAQAAAAAAAAAAAAAAAAQDAAIBBRAAAgEEAQMDAQkBAAAAAAAAAgEDAAUEEQYxEyESYUGScZHhUkIHMqEjFBEAAgMAAgICAwEAAAAAAAAAAgEDABEEITESE2EiQVEy/8AAEQgAHgAeAwESAAISAAMSAP/aAAwDAQACEQMRAD8A7AMw48RynvQCyevaow52KaYsk001r7am2Y7LNVTj/e+OPkP/ABgJKEZe29i99dUA5dZoLbzGOSSMRgnmRepLXhuqOVosqpRYyd/uuGDQ3ukcYxkhxLtK9gPNjycbEyx/hKhf1UOmuWAuORLFP19qIGteyohO4GNLugvU8tpRJG9T83PyKe4WfLUsCZxTrwl8PrXsPL7VmYcPeDuMfHnzpqrbZ62vdy54MnEhW2QffSLk3WeEUbZNLqt9a3HWF4uey/tRG9JUxfMaHkF1TmMXHDti90rDyT0qY1GaLX5vxoWSEzP6rr0oOTHFFi/1RNtbny3PsmW8KKQiBtiktvarBj3fFyc1zTYvcME2mWnQr+UC6pPqm70hKCUFud3n/IQj03bhyaaKP/KTyRNkL/TSpd7qeTdJ3ACgSfT4/qlx8jV+Xm2KAG6RyOGxLQ7Tqg5cgiu9v//Z"
      }
    ],
    "current_page": 1,
    "per_page": 24,
    "has_next": true
  }
}

Show more
GIF - Categories API
Use this endpoint to retrieve a list of curated categories that group KLIPY GIFs by common themes, moods, and reactions.

Categories can be shown as buttons, filters, or tabs in your UI, and are fully compatible with the Search API to help users discover content faster.

See our Demo App Source Code for an example of category-based integration.

Query Parameters
locale
string
Language of the user in xx_YY format, where: xx is the ISO 639-1 (https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes#Table) two-letter language code and YY is the ISO 3166-1 (https://en.wikipedia.org/wiki/ISO_3166-1#Codes) alpha-2 two-letter country code

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

ResponseExpand all
200
Object
Response Attributes
result
boolean
data
object
Show child attributes

Was this section helpful?
Yes
No
GET

/api/v1/{app_key}/gifs/categories?locale={country_code}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/categories?locale={country_code}' \
Response

200
{
  "result": true,
  "data": {
    "locale": "en_US",
    "categories": [
      {
        "category": "smile",
        "query": "smile",
        "preview_url": "https://static.klipy.com/ii/e293a233a303a98e471f78d04e13a1b0/a5/fd/NnGoLmO8.gif"
      },
      {
        "category": "aww",
        "query": "aww",
        "preview_url": "https://static.klipy.com/ii/925f17378dd1893b674a723c07535afe/1c/24/Oizp49sT.gif"
      },
      {
        "category": "high five",
        "query": "high five",
        "preview_url": "https://static.klipy.com/ii/925f17378dd1893b674a723c07535afe/d9/e6/rtepipfC.gif"
      },
      {
        "category": "good morning",
        "query": "good morning",
        "preview_url": "https://static.klipy.com/ii/ce286d05b8e1a47cd4f32b0e1b6dec0e/a6/f3/SEmLt8aA.gif"
      },
      {
        "category": "good night",
        "query": "good night",
        "preview_url": "https://static.klipy.com/ii/f87f46a2c5aeaeed4c68910815f73eaf/af/77/35MgTkW5.gif"
      }
    ]
  }
}

Show more
GIF - Recent Items API [per user]
Use this endpoint to retrieve a list of GIFs recently used by a specific user. It’s ideal for implementing “Recently Used” sections in keyboards, messaging apps, or content pickers.

Pass a unique customer_id to fetch per-user history without storing content manually.

To include ads alongside recents, see the Advertisements section

Query Parameters
page
integer
The requested page number

Minimum
1
Default value
1
per_page
integer
The number of content items per page

Minimum
1
Maximum
32
Default value
10
Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

customer_id
string
Required
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

ResponseExpand all
200
Object
Response Attributes
result
boolean
data
object
Show child attributes

Was this section helpful?
Yes
No
GET

/api/v1/{app_key}/gifs/recent/{customer_id}?page={page}&per_page={per_page}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/recent/{customer_id}?page={page}&per_page={per_page}' \
Response

200
{
  "result": true,
  "data": {
    "data": [
      {
        "id": 8041071659142944,
        "slug": "hello-hi-662",
        "title": "Hello",
        "file": {
          "hd": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif",
              "width": 498,
              "height": 498,
              "size": 4001918
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/eUbp2uNc.webp",
              "width": 498,
              "height": 498,
              "size": 285228
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg",
              "width": 498,
              "height": 498,
              "size": 19255
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KkjHgST0WkvqPhrQBEj.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "md": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/8GCrVAB7.gif",
              "width": 498,
              "height": 498,
              "size": 3721260
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp",
              "width": 498,
              "height": 498,
              "size": 643490
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/UsX8Vqtm.jpg",
              "width": 498,
              "height": 498,
              "size": 20086
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/V6da8Awi.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KYvHAODcgRYMmD.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "sm": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/y6iepZM7.gif",
              "width": 220,
              "height": 220,
              "size": 314884
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp",
              "width": 220,
              "height": 220,
              "size": 80118
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/uvntdY4w.jpg",
              "width": 220,
              "height": 220,
              "size": 8560
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/3c2Tqd1S.mp4",
              "width": 320,
              "height": 320,
              "size": 49565
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/E4zwjSqD1BNoXKAEm1UE.webm",
              "width": 320,
              "height": 320,
              "size": 48827
            }
          },
          "xs": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/A4bPjSsj.gif",
              "width": 90,
              "height": 90,
              "size": 71468
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/Sp4pln3Z.webp",
              "width": 90,
              "height": 90,
              "size": 25340
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/cGfi4U83.jpg",
              "width": 90,
              "height": 90,
              "size": 2949
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/La0HaAzw.mp4",
              "width": 150,
              "height": 150,
              "size": 20257
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/45Vik66JyFsr7B6NrYM.webm",
              "width": 150,
              "height": 150,
              "size": 38333
            }
          }
        },
        "tags": [],
        "type": "gif",
        "blur_preview": "data:image/jpeg;base64,/9j//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAADAQEBAAAAAAAAAAAAAAAFBgMEBwEBAAIDAQAAAAAAAAAAAAAAAAQDAAIBBRAAAgEEAQMDAQkBAAAAAAAAAgEDAAUEEQYxEyESYUGScZHhUkIHMqEjFBEAAgMAAgICAwEAAAAAAAAAAgEDABEEITESE2EiQVEy/8AAEQgAHgAeAwESAAISAAMSAP/aAAwDAQACEQMRAD8A7AMw48RynvQCyevaow52KaYsk001r7am2Y7LNVTj/e+OPkP/ABgJKEZe29i99dUA5dZoLbzGOSSMRgnmRepLXhuqOVosqpRYyd/uuGDQ3ukcYxkhxLtK9gPNjycbEyx/hKhf1UOmuWAuORLFP19qIGteyohO4GNLugvU8tpRJG9T83PyKe4WfLUsCZxTrwl8PrXsPL7VmYcPeDuMfHnzpqrbZ62vdy54MnEhW2QffSLk3WeEUbZNLqt9a3HWF4uey/tRG9JUxfMaHkF1TmMXHDti90rDyT0qY1GaLX5vxoWSEzP6rr0oOTHFFi/1RNtbny3PsmW8KKQiBtiktvarBj3fFyc1zTYvcME2mWnQr+UC6pPqm70hKCUFud3n/IQj03bhyaaKP/KTyRNkL/TSpd7qeTdJ3ACgSfT4/qlx8jV+Xm2KAG6RyOGxLQ7Tqg5cgiu9v//Z"
      }
    ],
    "current_page": 1,
    "per_page": 10,
    "has_next": true
  }
}

Show more
GIF - Items API
Use this endpoint to retrieve one or more specific GIFs by their slugs. Ideal for restoring saved content, displaying favorites, or loading shared links.

Provide the Slugs parameter - each as a comma-separated list - to fetch multiple items in a single request.

Query Parameters
slugs
string
A comma-separated list of Slugs.

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

ResponseExpand all
200
Object
Response Attributes
result
boolean
data
object
Show child attributes

Was this section helpful?
Yes
No
GET

/api/v1/{app_key}/gifs/items?slugs={value}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/items?slugs={value}' \
Response

200
{
  "result": true,
  "data": {
    "data": [
      {
        "id": 8041071659142944,
        "slug": "hello-hi-662",
        "title": "Hello",
        "file": {
          "hd": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/um0L4dFH.gif",
              "width": 498,
              "height": 498,
              "size": 4001918
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/eUbp2uNc.webp",
              "width": 498,
              "height": 498,
              "size": 285228
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/LyWpim71.jpg",
              "width": 498,
              "height": 498,
              "size": 19255
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/MCCBoQlZ.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KkjHgST0WkvqPhrQBEj.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "md": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/8GCrVAB7.gif",
              "width": 498,
              "height": 498,
              "size": 3721260
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/JUYsGsrc.webp",
              "width": 498,
              "height": 498,
              "size": 643490
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/UsX8Vqtm.jpg",
              "width": 498,
              "height": 498,
              "size": 20086
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/V6da8Awi.mp4",
              "width": 498,
              "height": 498,
              "size": 119294
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/KYvHAODcgRYMmD.webm",
              "width": 498,
              "height": 498,
              "size": 79936
            }
          },
          "sm": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/y6iepZM7.gif",
              "width": 220,
              "height": 220,
              "size": 314884
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/SE72470w.webp",
              "width": 220,
              "height": 220,
              "size": 80118
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/uvntdY4w.jpg",
              "width": 220,
              "height": 220,
              "size": 8560
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/3c2Tqd1S.mp4",
              "width": 320,
              "height": 320,
              "size": 49565
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/E4zwjSqD1BNoXKAEm1UE.webm",
              "width": 320,
              "height": 320,
              "size": 48827
            }
          },
          "xs": {
            "gif": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/A4bPjSsj.gif",
              "width": 90,
              "height": 90,
              "size": 71468
            },
            "webp": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/Sp4pln3Z.webp",
              "width": 90,
              "height": 90,
              "size": 25340
            },
            "jpg": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/cGfi4U83.jpg",
              "width": 90,
              "height": 90,
              "size": 2949
            },
            "mp4": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/La0HaAzw.mp4",
              "width": 150,
              "height": 150,
              "size": 20257
            },
            "webm": {
              "url": "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af/45Vik66JyFsr7B6NrYM.webm",
              "width": 150,
              "height": 150,
              "size": 38333
            }
          }
        },
        "tags": [],
        "type": "gif",
        "blur_preview": "data:image/jpeg;base64,/9j//gAQTGF2YzU5LjM3LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAADAQEBAAAAAAAAAAAAAAAFBgMEBwEBAAIDAQAAAAAAAAAAAAAAAAQDAAIBBRAAAgEEAQMDAQkBAAAAAAAAAgEDAAUEEQYxEyESYUGScZHhUkIHMqEjFBEAAgMAAgICAwEAAAAAAAAAAgEDABEEITESE2EiQVEy/8AAEQgAHgAeAwESAAISAAMSAP/aAAwDAQACEQMRAD8A7AMw48RynvQCyevaow52KaYsk001r7am2Y7LNVTj/e+OPkP/ABgJKEZe29i99dUA5dZoLbzGOSSMRgnmRepLXhuqOVosqpRYyd/uuGDQ3ukcYxkhxLtK9gPNjycbEyx/hKhf1UOmuWAuORLFP19qIGteyohO4GNLugvU8tpRJG9T83PyKe4WfLUsCZxTrwl8PrXsPL7VmYcPeDuMfHnzpqrbZ62vdy54MnEhW2QffSLk3WeEUbZNLqt9a3HWF4uey/tRG9JUxfMaHkF1TmMXHDti90rDyT0qY1GaLX5vxoWSEzP6rr0oOTHFFi/1RNtbny3PsmW8KKQiBtiktvarBj3fFyc1zTYvcME2mWnQr+UC6pPqm70hKCUFud3n/IQj03bhyaaKP/KTyRNkL/TSpd7qeTdJ3ACgSfT4/qlx8jV+Xm2KAG6RyOGxLQ7Tqg5cgiu9v//Z"
      }
    ]
  }
}

Show more
GIF - Hide from Recent
Use this endpoint to remove a specific GIF from a user’s Recent list. Helpful for clearing sensitive content, handling undo actions, or improving personalization.

Pass the user’s customer_id and the slug of the GIF to be hidden.

Query Parameters
slug
string
Required
The slug of the GIF you want to delete from the list

Minimum
1
Default value
1
Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

customer_id
string
Required
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

Response
200
Object
Response Attributes
result
boolean
data
array
Was this section helpful?
Yes
No
DELETE

/api/v1/{app_key}/gifs/recent/{customer_id}?slug={slug}

cURL


curl --location --globoff --request DELETE 'https://api.klipy.com/api/v1/{app_key}/gifs/recent/{customer_id}?slug={slug}' \
Response

200
{
  "result": true,
  "data": []
}

GIF - Share Trigger API
Use this endpoint to log when a user shares a specific GIF. This improves personalization and helps surface more relevant content based on sharing behavior.

No personal data is collected. Just pass a stable customer_id (e.g. a hash or UUID) to associate the event with the user anonymously.

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

slug
string
Required
The slug of the GIF you wish to use in order to trigger the 'share' action in the analytics system

Body Parameters
customer_id
string
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

q
string
The search string that leads to this share. Doesn't have a default value.

Required for the Search API. Keep empty when using the Trending API.

Response
200
Object
Response Attributes
result
boolean
Was this section helpful?
Yes
No
POST

/api/v1/{app_key}/gifs/share/{slug}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/share/{slug}' \
--data '{
  "customer_id": "{customer_id}",
  "q": "{q}"
}'
Response

200
{
  "result": true
}

GIF - Report API
Use this endpoint to report a GIF that was flagged by a user on your platform. This helps KLIPY detect and review inappropriate or unwanted content to keep the experience safe and high quality.

Include a stable customer_id and a short reason string (e.g., "nsfw", "spam", "offensive").

Reason

Description

`nudity`

Nudity or sexually explicit content.

`violence`

Graphic violence or violent behavior.

`hate_speech`

Racist, homophobic, or hateful content.

`harassment`

Bullying, personal attacks, or targeted harassment.

`spam`

Repetitive, irrelevant, or misleading content.

`misinformation`

False claims, misleading text, or manipulated media.

`copyright`

Content believed to infringe on intellectual property rights.

`offensive`

Generally offensive or culturally inappropriate material.

`illegal`

Content that promotes or depicts illegal activity.

`broken`

Content doesn’t load, is corrupted, or is unplayable.

`low_quality`

Extremely low resolution or unreadable content.

`not_relevant`

Content doesn’t match the tag/query or is miscategorized.

`impersonation`

Fake identity, misleading branding, or impersonation.

`other`

Other issues not listed above. Free-text description recommended.

Path Parameters
app_key
string
Required
The unique app key issued by KLIPY for your system

slug
string
Required
The slug of the GIF you wish to report

Body Parameters
customer_id
string
A unique user identifier in your system. Please make sure that the value remains consistent for the same user.

reason
string
Required
The reason for reporting the content, providing context for KLIPY's review process.

Response
200
Object
Response Attributes
result
boolean
Was this section helpful?
Yes
No
POST

/api/v1/{app_key}/gifs/report/{slug}

cURL


curl --location --globoff 'https://api.klipy.com/api/v1/{app_key}/gifs/report/{slug}' \
--data '{
  "customer_id": "{customer_id}",
  "reason": "{reason}"
}'
Response

200
{
  "result": true
}

GIF Format Sizes
The file size for each content format depends on the dimensions and duration of the specific GIF selected. Therefore, the mean and median values shown in the following table should be considered general guidelines rather than strict values.

Size
File format
Mean file size (KB)
Median file size (KB)
hd

gif

3874

2578

hd

webp

755

288

hd

webm

136

94

hd

mp4

492

295

hd

jpg

19

16

xs

gif

101

64

xs

webp

51

35

xs

webm

45

37

xs

mp4

37

31

xs

jpg

2

2

sm

gif

330

206

sm

webp

178

117

sm

webm

74

60

sm

mp4

98

85

sm

jpg

7

6

md

gif

2263

1405

md

webp

988

636

md

webm

136

94

md

mp4

444

257

md

jpg

20

19

Was this section helpful?
Yes
No
Sticker API
In this section you'll find information about how to use Sticker feature of KLIPY.

This API enables you to integrate KLIPY`s database of trending stickers into your platform, providing you with an engaging search experience while messaging. You can search, preview, and share popular stickers based on keywords or tags, ensuring relevant and captivating content is easily accessible.


Show more

Endpoints
GET
api/v1/{app_key}/stickers/trending?page={page}&per_page={per_page}&customer_id={customer_i...

GET
api/v1/{app_key}/stickers/search?page={page}&per_page={per_page}&q={q}&customer_id={custom...

GET
api/v1/{app_key}/stickers/categories?locale={country_code}

GET
api/v1/{app_key}/stickers/recent/{customer_id}?page={page}&per_page={per_page}

GET
api/v1/{app_key}/stickers/items?slugs={value}

DELETE
api/v1/{app_key}/stickers/recent/{customer_id}?slug={slug}

POST
api/v1/{app_key}/stickers/share/{slug}

POST
api/v1/{app_key}/stickers/report/{slug}

Clip API
In this section you'll find information about how to use the Clip feature of KLIPY.

This API enables you to integrate KLIPY's database of trending movie and video clips into your platform, providing you with an engaging experience while messaging. You can search, preview, and share popular clips based on keywords or tags, ensuring relevant and captivating content is easily accessible.

Please note that the clips library is not yet fully MPA-rated.


Show more

Endpoints
GET
api/v1/{app_key}/clips/trending?page={page}&per_page={per_page}&customer_id={customer_id}&...

GET
api/v1/{app_key}/clips/search?page={page}&per_page={per_page}&q={q}&customer_id={customer_...

GET
api/v1/{app_key}/clips/categories?locale={country_code}

GET
api/v1/{app_key}/clips/recent/{customer_id}?page={page}&per_page={per_page}

GET
api/v1/{app_key}/clips/items?slugs={value}

DELETE
api/v1/{app_key}/clips/recent/{customer_id}?slug={slug}

POST
api/v1/{app_key}/clips/share/{slug}

POST
api/v1/{app_key}/clips/report/{slug}

Meme API
KLIPY’s Meme API allows you to integrate a wide range of the world’s most famous and trending memes into your platform. With this API, users can search, preview, and share popular memes instantly, adding a touch of humor and relevance to their messaging or social experience. Whether it’s viral moments, iconic pop culture references, or current events, the Meme API helps you keep your content fresh and engaging with the internet's most relatable and shareable memes.


Show more

Endpoints
GET
api/v1/{app_key}/static-memes/trending?page={page}&per_page={per_page}&customer_id={custom...

GET
api/v1/{app_key}/static-memes/search?page={page}&per_page={per_page}&q={q}&customer_id={cu...

GET
api/v1/{app_key}/static-memes/categories?locale={country_code}

GET
api/v1/{app_key}/static-memes/recent/{customer_id}?page={page}&per_page={per_page}

GET
api/v1/{app_key}/static-memes/items?slugs={value}

DELETE
api/v1/{app_key}/static-memes/recent/{customer_id}?slug={slug}

POST
api/v1/{app_key}/static-memes/share/{slug}

POST
api/v1/{app_key}/static-memes/report/{slug}

AI Emoji API
KLIPY’s AI Emoji API allows you to integrate a wide range of the world’s most famous and trending AI Emojis into your platform. With this API, users can search, preview, and share popular AI Emojis instantly, adding a touch of humor and relevance to their messaging or social experience. Whether it’s viral moments, iconic pop culture references, or current events, the AI Emoji API helps you keep your content fresh and engaging with the internet's most relatable and shareable AI Emojis.


Show more

Endpoints
POST
api/v1/{app_key}/emojis/generate

GET
api/v1/{app_key}/emojis/generated/{id}

GET
api/v1/{app_key}/emojis/trending?page={page}&per_page={per_page}&customer_id={customer_id}...

GET
api/v1/{app_key}/emojis/search?page={page}&per_page={per_page}&q={q}&customer_id={customer...

GET
api/v1/{app_key}/emojis/categories?locale={country_code}

GET
api/v1/{app_key}/emojis/recent/{customer_id}?page={page}&per_page={per_page}

GET
api/v1/{app_key}/emojis/items?slugs={value}

DELETE
api/v1/{app_key}/emojis/recent/{customer_id}?slug={slug}

POST
api/v1/{app_key}/emojis/share/{slug}

POST
api/v1/{app_key}/emojis/report/{slug}

Search Suggestions & Autocomplete
This section provides two related endpoints that enhance the search experience:

Search Suggestions help users refine their queries or discover related terms.
Autocomplete helps users complete a query as they type.

Show more

Endpoints
GET
api/v1/{app_key}/search-suggestions/{q}?limit=10

GET
api/v1/{app_key}/autocomplete/{q}?limit=10

Advertisements
To enable ads, ensure they are activated for the relevant API key in the KLIPY Partner Dashboard

If ads are enabled for your app, some API responses may include an advertisement object. These will appear alongside content objects (e.g., Clip, GIF, Sticker, Meme).

Each object in the response includes a type field. When type is set to "ad", it indicates that the object is an advertisement.


Show more

API Usage & Attribution Guidelines
To ensure a consistent and high-quality experience across all platforms, applications using the KLIPY API must include clear attribution.

Set “Search KLIPY” as the default placeholder text in the search input field - REQUIRED
Display a KLIPY watermark on the shared content message card - STRONGLY RECOMMENDED
Display a visible “Powered by KLIPY” mark wherever KLIPY content is shown - OPTIONAL.
You can download the official KLIPY logo assets here: Download Them Here.

Following these guidelines helps maintain brand consistency and ensures transparency for end-users.

Was this section helpful?
Yes
No
Content filtering
KLIPY provides content filtering tools that allow developers to control the types of media shown to users based on MPA-style ratings. These filters help ensure a safe and family-friendly user experience by excluding sensitive material such as explicit nudity, violence, or substance use.

You can configure filters globally or by country using the Partner Dashboard.

If you come across content that should be filtered but isn’t, please contact us at support@klipy.com so we can review and address it promptly.

Filter Categories:

In the tables below, you'll find what types of content are allowed for each ContentFilter option

Profanity

Violence

Sexual content

Substance use

Miscellaneous

Was this section helpful?
Yes
No
Migrate from Tenor
Migrating from Tenor? The switch is seamless. Simply replace the base URL tenor.googleapis.com with api.klipy.com in your codebase and plug in your KLIPY API key. Your GIF experience will continue to run smoothly.

Here's the full guide:

1
Generate your Key
Visit the Partner Panel, navigate to API Keys and create your platform.

2
Swap URL
Replace your existing base URLs with KLIPY's endpoints.

3
Add Attribution
Incorporate KLIPY branding into your interface.

4
Go Live
Once complete, request production access via Partner Panel.

For a more detailed look at our endpoints, review the technical specifications for each API below.