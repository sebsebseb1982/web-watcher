import subprocess
import os
import http.client, urllib
import schedule
import time
from lxml import html
from dotenv import load_dotenv

load_dotenv()
PUSHOVER_USER = os.getenv('PUSHOVER_USER')
PUSHOVER_TOKEN = os.getenv('PUSHOVER_TOKEN')

class CrawlResult:
    def __init__(self, value: str, page_title:str):
        self.value = value
        self.page_title = page_title


class Job:
    def __init__(self, url: str, xpath:str):
        self.url = url
        self.xpath = xpath

    def launch(self):
        self.notify(extract_value(
            crawl_url(self.url),
            self.xpath
        ))

    def notify(self, crawl_result:CrawlResult):
        print(crawl_result.__dict__)
        conn = http.client.HTTPSConnection("api.pushover.net:443")
        conn.request("POST", "/1/messages.json",
        urllib.parse.urlencode({
            "token": PUSHOVER_TOKEN,
            "user": PUSHOVER_USER,
            "message": f"Prix {crawl_result.value}€\n{self.url}",
            "title": crawl_result.page_title
        }), { "Content-type": "application/x-www-form-urlencoded" })
        conn.getresponse()


def crawl_url(url: str) -> str:
    result = subprocess.run(["google-chrome", "--headless", "--incognito", "--disable-gpu", "--dump-dom", url], stdout=subprocess.PIPE)
    return result.stdout.decode()


def extract_value(response_body:str, xpath:str) -> CrawlResult:
    tree = html.fromstring(response_body)
    return CrawlResult(
        tree.xpath(xpath)[0],
        tree.xpath('//title/text()')[0]
    )


def test():
    Job(
        "https://www.amazon.fr/Dreame-Aspirateur-Autonettoyante-Automatique-dobstacles/dp/B0B8X43GQH/",
        '//div[@id="corePrice_feature_div"]//div[@class="a-spacing-top-mini"]//span[@class="a-price-whole"]/text()'
    ).launch()

schedule.every(1).minutes.do(test)

while True:
    schedule.run_pending()
    time.sleep(1)