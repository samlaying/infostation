from setuptools import setup, find_packages

setup(
    name="cli-anything-infostation",
    version="0.1.0",
    author="cli-anything contributors",
    description="Agent-native CLI for InfoStation — capture, categorize, and act on information via the InfoStation REST API.",
    long_description="Command-line interface for InfoStation (AI-driven personal information hub). Covers every web UI operation: process inputs (URL/text), manage knowledge cards, TODO board, analytics, weekly reports, backup/import, settings. Pure Python stdlib — zero dependencies.",
    long_description_content_type="text/markdown",
    packages=find_packages(),
    python_requires=">=3.8",
    entry_points={
        "console_scripts": [
            "cli-anything-infostation=cli_anything.infostation.infostation_cli:main",
        ]
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "Topic :: Utilities",
        "Intended Audience :: Developers",
    ],
)
