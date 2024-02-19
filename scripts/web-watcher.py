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

class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


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
    result = subprocess.run(["google-chrome-stable", "--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", url], stdout=subprocess.PIPE)
    print_result(f"Crawl {url}", result.returncode==0)
    return result.stdout.decode()


def extract_value(response_body:str, xpath:str) -> CrawlResult:
    tree = html.fromstring(response_body)
    value=tree.xpath(xpath)
    pageTitle=tree.xpath('//title/text()')
    if value and pageTitle:
        print_result(f"Extract value", True)
        return CrawlResult(
            value[0],
            pageTitle[0]
        )
    else:
        print_result(f"Extract value", False)
        return None

def print_result(message:str, ok:bool):
    if ok:
        print(f"{bcolors.OKGREEN}[OK]{bcolors.ENDC} {message}")
    else:
        print(f"{bcolors.FAIL}[KO]{bcolors.ENDC} {message}")


#def test():
#    Job(
#        "https://www.amazon.fr/Dreame-Aspirateur-Autonettoyante-Automatique-dobstacles/dp/B0B8X43GQH/",
#        '//div[@id="corePrice_feature_div"]//div[@class="a-spacing-top-mini"]//span[@class="a-price-whole"]/text()'
#    ).launch()
#
#schedule.every(1).minutes.do(test)
#
#while True:
#    schedule.run_pending()
#    time.sleep(1)

Job(
    "https://www.amazon.fr/Dreame-Aspirateur-Autonettoyante-Automatique-dobstacles/dp/B0B8X43GQH/",
    '//div[@id="corePrice_feature_div"]//div[@class="a-spacing-top-mini"]//span[@class="a-price-whole"]/text()'
).launch()