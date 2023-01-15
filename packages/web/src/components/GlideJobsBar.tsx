const GlideJobsBar = () => {
    return (
        <div className="fixed inset-x-0 bottom-0">
            <a href="https://www.glideapps.com/jobs?quicktype" target="_blank" rel="noopener nofollow noreferrer">
                <div className="bg-gradient">
                    <div className="px-3 py-3 mx-auto max-w-7xl sm:px-6 lg:px-8">
                        <div className="flex items-center justify-center">
                            <div className="flex items-center">
                                <span className="flex p-2 bg-black rounded-lg">
                                    <svg
                                        className="w-6 h-6 text-white"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        aria-hidden="true"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                                        />
                                    </svg>
                                </span>
                                <p className="ml-3 text-base font-medium text-white truncate">
                                    <span className="hidden md:inline">
                                        The creators of <span className="font-mono font-black">quicktype</span> are{" "}
                                    </span>
                                    <span className="md:hidden">We're </span>
                                    hiring engineers
                                    <span className="hidden sm:inline"> for an exciting new project</span>.{" "}
                                    <span className="font-black">Learn more &rarr;</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </a>
        </div>
    );
};

export default GlideJobsBar;
